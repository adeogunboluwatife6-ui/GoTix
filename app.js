(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const configReady = window.GATHER_SUPABASE_URL
    && !window.GATHER_SUPABASE_URL.includes("YOUR_PROJECT")
    && window.GATHER_SUPABASE_ANON_KEY
    && !window.GATHER_SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const supabase = configReady && window.supabase
    ? window.supabase.createClient(window.GATHER_SUPABASE_URL, window.GATHER_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
    : null;

  const state = {
    user: null,
    profile: null,
    events: [],
    orders: [],
    tickets: [],
    activeDays: 30,
    channel: null,
    authMode: "signin",
    noticeTimer: null,
    toastTimer: null
  };

  const currency = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  });
  const dateFormatter = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" });
  const shortDate = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" });

  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.remove("hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.add("hidden"), 4500);
  }

  function setNotice(message) {
    const notice = $("#notice");
    if (!message) {
      notice.classList.add("hidden");
      notice.textContent = "";
      return;
    }
    notice.textContent = message;
    notice.classList.remove("hidden");
    clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => notice.classList.add("hidden"), 12000);
  }

  function showMissingEventsSetup() {
    const notice = $("#notice");
    notice.innerHTML = 'The dashboard cannot save until the database tables exist. Download <a href="supabase-schema.sql" download>supabase-schema.sql</a>, open the <a href="https://supabase.com/dashboard/project/ulvnrupmtpfplnuyaxmr/sql/new" target="_blank" rel="noopener noreferrer">SQL Editor for project ulvnrupmtpfplnuyaxmr</a>, paste the full SQL file into a new query, and click <strong>Run</strong>. Then reload this dashboard.';
    notice.classList.remove("hidden");
    clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => notice.classList.add("hidden"), 30000);
  }

  function explainDatabaseError(error) {
    const message = error?.message || "Unknown database error.";
    const missingEvents = error?.code === "PGRST205"
      || (message.includes("Could not find the table") && message.includes("events"));
    const missingOrganizerProfile = error?.code === "23503"
      && (message.includes("events_organizer_id_fkey")
        || message.includes("events.organizer_id"));
    if (missingEvents) {
      return "Supabase is missing public.events. In your Supabase dashboard, open SQL Editor, run the full supabase-schema.sql file from this project, then reload this page. Make sure you ran it in project ulvnrupmtpfplnuyaxmr.";
    }
    if (missingOrganizerProfile) {
      return "Your organizer account is missing its profiles row. Run the updated supabase-schema.sql in the Supabase SQL Editor for project ulvnrupmtpfplnuyaxmr; it backfills profiles for existing organizer accounts. Then reload the dashboard and try again.";
    }
    return message;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function initials(nameOrEmail) {
    const words = String(nameOrEmail || "O").trim().split(/\s+/);
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  }

  function formatDate(value, formatter = dateFormatter) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : formatter.format(date);
  }

  function titleCase(value) {
    return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function eventMap() {
    return new Map(state.events.map((event) => [event.id, event]));
  }

  function statusPill(status) {
    const normalized = String(status || "unknown").toLowerCase().replace(/[^a-z_]/g, "");
    return `<span class="status-pill ${escapeHtml(normalized)}">${escapeHtml(titleCase(normalized))}</span>`;
  }

  function setLoading(loading) {
    $("#loading-bar").classList.toggle("hidden", !loading);
  }

  function setConnection(status, label) {
    const dot = $(".status-dot");
    dot.classList.toggle("connected", status === "connected");
    dot.classList.toggle("offline", status === "offline");
    $("#connection-label").textContent = label;
  }

  function showAuth() {
    $("#auth-screen").classList.remove("hidden");
    $("#app-shell").classList.add("hidden");
  }

  function showApp() {
    $("#auth-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
  }

  function updateAuthForm() {
    const signup = state.authMode === "signup";
    $(".auth-card").classList.toggle("signup-mode", signup);
    $("#auth-heading").textContent = signup ? "Create your account" : "Welcome back";
    $("#auth-description").textContent = signup
      ? "Set up your organizer account to get started."
      : "Sign in to manage your events and tickets.";
    $("#auth-submit").textContent = signup ? "Create account" : "Sign in";
    $("#auth-switch-copy").textContent = signup ? "Already have an account?" : "New to Gather?";
    $("#auth-switch").textContent = signup ? "Sign in" : "Create an account";
    $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
    $("#auth-name").required = signup;
  }

  async function handleAuth(event) {
    event.preventDefault();
    if (!supabase) return;

    const button = $("#auth-submit");
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    button.disabled = true;

    try {
      if (state.authMode === "signup") {
        const name = $("#auth-name").value.trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name, role: "organizer" } }
        });
        if (error) throw error;
        if (data.session) {
          await loadDashboard(data.session.user);
        } else {
          showToast("Check your email to confirm your account, then sign in.");
          state.authMode = "signin";
          updateAuthForm();
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await loadDashboard(data.user);
      }
    } catch (error) {
      showToast(error.message || "Unable to authenticate. Please try again.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function loadProfile() {
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", state.user.id)
      .maybeSingle();
    if (error) throw error;
    state.profile = data;
    const name = data?.full_name || state.user.user_metadata?.full_name || "Organizer";
    const avatar = initials(name);
    $("#user-name").textContent = name;
    $("#user-email").textContent = state.user.email || "";
    $("#user-avatar").textContent = avatar;
    $("#top-avatar").textContent = avatar;
    $("#settings-name").textContent = name;
    $("#settings-email").textContent = state.user.email || "—";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    $("#page-title").innerHTML = `${greeting}<span class="heading-period">.</span>`;
    $("#today-label").textContent = new Intl.DateTimeFormat("en-NG", {
      weekday: "long", day: "numeric", month: "long"
    }).format(new Date()).toUpperCase();
  }

  async function loadDashboard(user = state.user) {
    if (!user) return;
    state.user = user;
    showApp();
    setLoading(true);
    setNotice("");

    try {
      await loadProfile();
      const [eventsResult, ordersResult, ticketsResult] = await Promise.all([
        supabase.from("events")
          .select("id, title, category, format, venue, starts_at, ends_at, status")
          .eq("organizer_id", user.id)
          .order("starts_at", { ascending: true }),
        supabase.from("orders")
          .select("id, event_id, total_amount, status, created_at, events!inner(title, organizer_id)")
          .eq("events.organizer_id", user.id)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("tickets")
          .select("id, event_id, ticket_type_id, ticket_code, attendee_name, attendee_email, checked_in_at, created_at, events!inner(title, organizer_id), ticket_types(name)")
          .eq("events.organizer_id", user.id)
          .order("created_at", { ascending: false })
          .limit(500)
      ]);
      if (eventsResult.error) throw eventsResult.error;
      if (ordersResult.error) throw ordersResult.error;
      if (ticketsResult.error) throw ticketsResult.error;
      state.events = eventsResult.data || [];
      state.orders = ordersResult.data || [];
      state.tickets = ticketsResult.data || [];
      renderDashboard();
      setConnection("connected", "Supabase connected");
    } catch (error) {
      setConnection("offline", "Connection issue");
      if (explainDatabaseError(error).includes("Supabase is missing public.events")) {
        showMissingEventsSetup();
      } else {
        setNotice(`Could not load your dashboard from Supabase: ${explainDatabaseError(error)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function paidOrders() {
    return state.orders.filter((order) => order.status === "paid");
  }

  function renderDashboard() {
    const paid = paidOrders();
    const revenue = paid.reduce((total, order) => total + Number(order.total_amount || 0), 0);
    const upcoming = state.events.filter((event) =>
      new Date(event.starts_at).getTime() >= Date.now()
      && !["cancelled", "completed"].includes(event.status)
    );

    $("#stat-events").textContent = state.events.length.toLocaleString("en-NG");
    $("#stat-event-detail").textContent = `${state.events.filter((event) => event.status === "published").length} published · ${state.events.filter((event) => event.status === "draft").length} drafts`;
    $("#stat-tickets").textContent = state.tickets.length.toLocaleString("en-NG");
    $("#stat-revenue").textContent = currency.format(revenue);
    $("#stat-attendees").textContent = state.tickets.length.toLocaleString("en-NG");
    $("#finance-revenue").textContent = currency.format(revenue);
    $("#finance-orders").textContent = paid.length.toLocaleString("en-NG");
    renderUpcoming(upcoming);
    renderOrders($("#recent-orders"), state.orders.slice(0, 5));
    renderOrders($("#orders-table"), state.orders);
    renderEvents();
    renderTickets();
    renderSalesChart();
  }

  function renderUpcoming(events) {
    const list = $("#upcoming-events");
    if (!events.length) {
      list.innerHTML = '<div class="empty-state">No upcoming events yet.<br>Create an event to see it here.</div>';
      return;
    }
    list.innerHTML = events.slice(0, 4).map((event) => {
      const date = event.starts_at ? new Date(event.starts_at) : null;
      const day = date && !Number.isNaN(date.getTime()) ? date.getDate() : "—";
      const month = date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat("en-NG", { month: "short" }).format(date)
        : "TBD";
      return `<div class="upcoming-item">
        <div class="date-tile"><strong>${day}</strong><span>${escapeHtml(month)}</span></div>
        <div class="upcoming-copy"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.venue || titleCase(event.format))}</small></div>
        <span class="upcoming-status">${escapeHtml(titleCase(event.status))}</span>
      </div>`;
    }).join("");
  }

  function renderOrders(element, orders) {
    if (!element) return;
    if (!orders.length) {
      element.innerHTML = `<tr><td colspan="5" class="empty-state">No orders yet. Verified ticket purchases will appear here.</td></tr>`;
      return;
    }
    const events = eventMap();
    element.innerHTML = orders.map((order) => {
      const title = order.events?.title || events.get(order.event_id)?.title || "Event";
      const orderId = String(order.id).slice(0, 8).toUpperCase();
      return `<tr>
        <td><strong>#${escapeHtml(orderId)}</strong></td>
        <td>${escapeHtml(title)}</td>
        <td class="table-muted">${escapeHtml(formatDate(order.created_at))}</td>
        <td><strong>${escapeHtml(currency.format(Number(order.total_amount || 0)))}</strong></td>
        <td>${statusPill(order.status)}</td>
      </tr>`;
    }).join("");
  }

  function renderEvents(events = state.events) {
    const body = $("#events-table");
    if (!body) return;
    if (!events.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No events yet. Create your first event to get started.</td></tr>';
      return;
    }
    const ticketsPerEvent = new Map();
    for (const ticket of state.tickets) {
      ticketsPerEvent.set(ticket.event_id, (ticketsPerEvent.get(ticket.event_id) || 0) + 1);
    }
    body.innerHTML = events.map((event) => `<tr>
      <td><strong>${escapeHtml(event.title)}</strong></td>
      <td>${escapeHtml(formatDate(event.starts_at))}</td>
      <td>${escapeHtml(event.venue || titleCase(event.format))}</td>
      <td>${(ticketsPerEvent.get(event.id) || 0).toLocaleString("en-NG")}</td>
      <td>${statusPill(event.status)}</td>
    </tr>`).join("");
  }

  function renderTickets() {
    const ticketsBody = $("#tickets-table");
    const attendeesBody = $("#attendees-table");
    if (!state.tickets.length) {
      ticketsBody.innerHTML = '<tr><td colspan="5" class="empty-state">Tickets will appear here after verified orders are issued.</td></tr>';
      attendeesBody.innerHTML = '<tr><td colspan="5" class="empty-state">Attendees will appear here after verified orders are issued.</td></tr>';
      return;
    }
    const events = eventMap();
    const rows = state.tickets.map((ticket) => {
      const eventName = ticket.events?.title || events.get(ticket.event_id)?.title || "Event";
      const checkin = ticket.checked_in_at
        ? `<span class="status-pill">Checked in</span>`
        : '<span class="table-muted">Not checked in</span>';
      const code = String(ticket.ticket_code || ticket.id).slice(0, 12);
      const ticketType = ticket.ticket_types?.name || "Ticket";
      return {
        ticketRow: `<tr><td><strong>${escapeHtml(ticket.attendee_name || "Attendee")}</strong></td><td>${escapeHtml(eventName)}</td><td>${escapeHtml(code)}</td><td>${escapeHtml(ticketType)}</td><td>${checkin}</td></tr>`,
        attendeeRow: `<tr><td><strong>${escapeHtml(ticket.attendee_name || "Attendee")}</strong></td><td>${escapeHtml(eventName)}</td><td>${escapeHtml(ticket.attendee_email || "—")}</td><td>${escapeHtml(ticketType)}</td><td>${checkin}</td></tr>`
      };
    });
    ticketsBody.innerHTML = rows.map((row) => row.ticketRow).join("");
    attendeesBody.innerHTML = rows.map((row) => row.attendeeRow).join("");
  }

  function renderSalesChart() {
    const days = state.activeDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    cutoff.setHours(0, 0, 0, 0);
    const amounts = new Map();
    for (const order of paidOrders()) {
      const date = new Date(order.created_at);
      if (date >= cutoff) {
        const key = date.toISOString().slice(0, 10);
        amounts.set(key, (amounts.get(key) || 0) + Number(order.total_amount || 0));
      }
    }
    const points = [];
    const totalDays = days <= 7 ? 7 : days <= 30 ? 30 : 90;
    for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      points.push({ date, amount: amounts.get(key) || 0 });
    }
    const total = points.reduce((sum, point) => sum + point.amount, 0);
    $("#chart-total").textContent = currency.format(total);
    $("#analytics-chart-total").textContent = currency.format(total);

    for (const [canvasId, emptyId] of [["sales-chart", "empty-chart"], ["analytics-chart", "analytics-empty-chart"]]) {
      const canvas = $(`#${canvasId}`);
      const empty = $(`#${emptyId}`);
      empty.classList.toggle("hidden", total > 0);
      drawChart(canvas, points, total);
    }
  }

  function drawChart(canvas, points, total) {
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);

    const left = 41;
    const right = 9;
    const top = 12;
    const bottom = 27;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const max = Math.max(...points.map((point) => point.amount), 1);
    const niceMax = max === 1 ? 5 : Math.ceil(max / 5) * 5;
    const formatter = new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 0 });
    context.font = '9px "DM Sans", sans-serif';
    context.textBaseline = "middle";

    for (let tick = 0; tick <= 4; tick += 1) {
      const y = top + plotHeight - (plotHeight * tick / 4);
      context.beginPath();
      context.strokeStyle = "#f0f0f4";
      context.lineWidth = 1;
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = "#a5a6b2";
      context.textAlign = "left";
      context.fillText(`₦${formatter.format(niceMax * tick / 4)}`, 0, y);
    }

    const count = points.length;
    const step = plotWidth / Math.max(count, 1);
    const barWidth = Math.max(2, Math.min(17, step * 0.46));
    const gradient = context.createLinearGradient(0, top, 0, top + plotHeight);
    gradient.addColorStop(0, "#7666e9");
    gradient.addColorStop(1, "#a99ff5");
    points.forEach((point, index) => {
      const barHeight = point.amount ? Math.max(2, (point.amount / niceMax) * plotHeight) : 0;
      const x = left + index * step + (step - barWidth) / 2;
      const y = top + plotHeight - barHeight;
      context.fillStyle = gradient;
      if (barHeight > 0) {
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
        context.fill();
      }
      if (count <= 7 || index % (count <= 30 ? 5 : 15) === 0 || index === count - 1) {
        context.fillStyle = "#9b9dab";
        context.textAlign = "center";
        context.fillText(shortDate.format(point.date), x + barWidth / 2, height - 9);
      }
    });
    if (total === 0) {
      context.fillStyle = "#a1a3af";
      context.font = '10px "DM Sans", sans-serif';
      context.textAlign = "center";
      context.fillText("No verified sales in this period", left + plotWidth / 2, top + plotHeight / 2);
    }
  }

  async function createEvent(event, status) {
    if (!supabase || !state.user) return;
    const form = $("#event-form");
    const formData = new FormData(form);
    const startsAt = new Date(formData.get("starts_at"));
    const endsAt = new Date(formData.get("ends_at"));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      showToast("The event end time must be later than the start time.", true);
      return;
    }
    const registrationDeadline = formData.get("registration_deadline")
      ? new Date(formData.get("registration_deadline"))
      : null;
    if (registrationDeadline && (
      Number.isNaN(registrationDeadline.getTime()) || registrationDeadline >= startsAt
    )) {
      showToast("Registration must close before the event starts.", true);
      return;
    }

    const button = status === "draft" ? $("#save-draft") : $("#submit-event");
    button.disabled = true;
    const record = {
      organizer_id: state.user.id,
      title: String(formData.get("title")).trim(),
      category: formData.get("category"),
      format: formData.get("format"),
      description: String(formData.get("description") || "").trim() || null,
      banner_url: String(formData.get("banner_url") || "").trim() || null,
      venue: String(formData.get("venue") || "").trim() || null,
      organizer_name: String(formData.get("organizer_name") || "").trim(),
      contact_email: String(formData.get("contact_email") || "").trim(),
      contact_phone: String(formData.get("contact_phone") || "").trim() || null,
      organizer_website: String(formData.get("organizer_website") || "").trim() || null,
      organizer_instagram: String(formData.get("organizer_instagram") || "").trim() || null,
      organizer_x: String(formData.get("organizer_x") || "").trim() || null,
      capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      registration_deadline: registrationDeadline?.toISOString() || null,
      visibility: formData.get("visibility"),
      status
    };
    try {
      const { error } = await supabase.from("events").insert(record);
      if (error) throw error;
      closeEventModal();
      form.reset();
      showToast(status === "draft" ? "Your event draft was saved." : "Your event is published and available on the public events page.");
      await loadDashboard();
      if (status === "draft") openView("events");
    } catch (error) {
      if (explainDatabaseError(error).includes("Supabase is missing public.events")) {
        showMissingEventsSetup();
        showToast("Database setup is required. Follow the highlighted instructions above.", true);
      } else {
        showToast(`Could not save your event: ${explainDatabaseError(error)}`, true);
      }
    } finally {
      button.disabled = false;
    }
  }

  function openEventModal() {
    const startInput = $("#event-start");
    const endInput = $("#event-end");
    const start = new Date(Date.now() + 7 * 86400000);
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600000);
    const toLocal = (date) => {
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    };
    startInput.value = toLocal(start);
    endInput.value = toLocal(end);
    $("#event-organizer-name").value = state.profile?.full_name || state.user?.user_metadata?.full_name || "";
    $("#event-contact-email").value = state.user?.email || "";
    $("#event-modal").classList.remove("hidden");
    $("#event-title").focus();
  }

  function closeEventModal() {
    $("#event-modal").classList.add("hidden");
  }

  function openView(view) {
    const section = $(`#${view}-view`);
    if (!section) return;
    $$(".view-panel").forEach((panel) => panel.classList.add("hidden"));
    section.classList.remove("hidden");
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    const labels = { overview: "Overview", events: "My events", tickets: "Tickets", attendees: "Attendees", orders: "Orders", finance: "Finance", analytics: "Analytics", settings: "Settings" };
    $("#breadcrumb-current").textContent = labels[view] || "Overview";
    $("#sidebar").classList.remove("open");
    if (view === "events") renderEvents();
  }

  function subscribeToUpdates() {
    if (state.channel) supabase.removeChannel(state.channel);
    state.channel = supabase.channel(`organizer-${state.user.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "events", filter: `organizer_id=eq.${state.user.id}`
      }, () => loadDashboard())
      .on("postgres_changes", {
        event: "*", schema: "public", table: "orders"
      }, () => loadDashboard())
      .on("postgres_changes", {
        event: "*", schema: "public", table: "tickets"
      }, () => loadDashboard())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnection("connected", "Live updates on");
      });
  }

  async function signOut() {
    if (state.channel) {
      await supabase.removeChannel(state.channel);
      state.channel = null;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast(`Could not sign out: ${error.message}`, true);
      return;
    }
    state.user = null;
    state.events = [];
    state.orders = [];
    state.tickets = [];
    showAuth();
  }

  function setupListeners() {
    $("#auth-form").addEventListener("submit", handleAuth);
    $("#auth-switch").addEventListener("click", () => {
      state.authMode = state.authMode === "signin" ? "signup" : "signin";
      updateAuthForm();
    });
    $$(".nav-item").forEach((item) => item.addEventListener("click", () => openView(item.dataset.view)));
    $$("[data-open-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.openView)));
    $("#create-event-button").addEventListener("click", openEventModal);
    $$("[data-create-event]").forEach((button) => button.addEventListener("click", openEventModal));
    $("#close-modal").addEventListener("click", closeEventModal);
    $("#event-modal").addEventListener("click", (event) => {
      if (event.target === $("#event-modal")) closeEventModal();
    });
    $("#event-form").addEventListener("submit", (event) => {
      event.preventDefault();
      createEvent(event, "published");
    });
    $("#save-draft").addEventListener("click", () => {
      if ($("#event-form").reportValidity()) createEvent(null, "draft");
    });
    $("#sales-range").addEventListener("change", (event) => {
      state.activeDays = Number(event.target.value);
      renderSalesChart();
    });
    $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#profile-button").addEventListener("click", signOut);
    $("#settings-signout").addEventListener("click", signOut);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeEventModal();
    });
    window.addEventListener("resize", () => {
      if (state.events.length || state.orders.length) renderSalesChart();
    });
  }

  async function start() {
    setupListeners();
    updateAuthForm();
    if (!supabase) {
      showAuth();
      setConnection("offline", "Configuration needed");
      showToast("Add your Supabase project URL and public anon key to supabase-config.js to connect.", true);
      return;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setNotice(`Could not check your Supabase session: ${error.message}`);
      showAuth();
    } else if (data.session) {
      await loadDashboard(data.session.user);
      subscribeToUpdates();
    } else {
      showAuth();
      setConnection("offline", "Not signed in");
    }
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        state.user = null;
        showAuth();
      } else if (event === "SIGNED_IN" && session.user.id !== state.user?.id) {
        loadDashboard(session.user).then(subscribeToUpdates);
      }
    });
  }

  start();
})();
