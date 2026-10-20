(() => {
  "use strict";

  const list = document.querySelector("#events-list");
  const notice = document.querySelector("#notice");
  const emptyState = document.querySelector("#empty-state");
  const eventCount = document.querySelector("#event-count");
  const paymentUrl = window.GATHER_MONNIFY_PAYMENT_URL;
  const configured = window.GATHER_SUPABASE_URL
    && !window.GATHER_SUPABASE_URL.includes("YOUR_PROJECT")
    && window.GATHER_SUPABASE_ANON_KEY
    && !window.GATHER_SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const client = configured && window.supabase
    ? window.supabase.createClient(window.GATHER_SUPABASE_URL, window.GATHER_SUPABASE_ANON_KEY)
    : null;
  const dateFormat = new Intl.DateTimeFormat("en-NG", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
  const moneyFormat = new Intl.NumberFormat("en-NG", {
    style: "currency", currency: "NGN", maximumFractionDigits: 0
  });

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.classList.remove("hidden");
  }

  function showMissingEventsSetup() {
    notice.innerHTML = 'The events table has not been created in Supabase yet. Download <a href="supabase-schema.sql" download>supabase-schema.sql</a>, then run it in the <a href="https://supabase.com/dashboard/project/ulvnrupmtpfplnuyaxmr/sql/new" target="_blank" rel="noopener noreferrer">SQL Editor for project ulvnrupmtpfplnuyaxmr</a>.';
    notice.classList.remove("hidden");
    notice.classList.add("error");
  }

  function explainDatabaseError(error) {
    const message = error?.message || "Unknown database error.";
    const missingEvents = error?.code === "PGRST205"
      || (message.includes("Could not find the table") && message.includes("events"));
    if (missingEvents) {
      return "Supabase is missing public.events. Run the full supabase-schema.sql file from this project in your Supabase SQL Editor, then reload this page.";
    }
    return message;
  }

  function isTicketOnSale(ticket) {
    const now = Date.now();
    const opens = ticket.sales_start ? new Date(ticket.sales_start).getTime() : null;
    const closes = ticket.sales_end ? new Date(ticket.sales_end).getTime() : null;
    return (opens === null || opens <= now) && (closes === null || closes >= now);
  }

  function safeWebUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function renderEvents(events, ticketsByEvent) {
    eventCount.textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;
    emptyState.classList.toggle("hidden", events.length > 0);
    if (!events.length) {
      list.innerHTML = "";
      return;
    }

    list.innerHTML = events.map((event) => {
      const tickets = ticketsByEvent.get(event.id) || [];
      const registrationOpen = !event.registration_deadline
        || new Date(event.registration_deadline).getTime() > Date.now();
      const salesOpen = registrationOpen ? tickets.filter(isTicketOnSale) : [];
      const ticketRows = salesOpen.length
        ? salesOpen.map((ticket, index) => `<div class="ticket-row">
            <div class="ticket-info"><strong>${escapeHtml(ticket.name)}</strong><small>${escapeHtml(ticket.description || "Event admission")}</small></div>
            <span class="ticket-price">${Number(ticket.price) === 0 ? "Free" : escapeHtml(moneyFormat.format(Number(ticket.price)))}</span>
          </div>`).join("")
        : '<div class="ticket-row"><div class="ticket-info"><strong>No tickets available</strong><small>Ticket sales are not open at this time.</small></div></div>';
      const ticketOptions = salesOpen.map((ticket) =>
        `<option value="${escapeHtml(ticket.id)}">${escapeHtml(ticket.name)} — ${Number(ticket.price) === 0 ? "Free" : escapeHtml(moneyFormat.format(Number(ticket.price)))}</option>`
      ).join("");
      const purchaseAction = salesOpen.length && paymentUrl
        ? `<div class="ticket-footer">
             <label class="sr-only" for="ticket-${escapeHtml(event.id)}">Choose ticket type</label>
             <select id="ticket-${escapeHtml(event.id)}" aria-label="Choose ticket type for ${escapeHtml(event.title)}">${ticketOptions}</select>
             <a class="pay-button" href="${escapeHtml(paymentUrl)}" target="_blank" rel="noopener noreferrer">Pay on Monnify <span>↗</span></a>
           </div>
           <p class="payment-warning">The shared payment link does not include the selected ticket or price. Verify the amount before paying.</p>`
        : "";
      const starts = event.starts_at ? new Date(event.starts_at) : null;
      const dateText = starts && !Number.isNaN(starts.getTime()) ? dateFormat.format(starts) : "Date to be announced";
      const bannerUrl = safeWebUrl(event.banner_url);
      const bannerStyle = bannerUrl ? ` style="background-image:url('${escapeHtml(bannerUrl)}')"` : "";
      const bannerClass = bannerUrl ? "event-art has-image" : "event-art";
      const details = [
        event.capacity ? `Capacity: ${Number(event.capacity).toLocaleString("en-NG")}` : null,
        event.registration_deadline
          ? `Registration closes ${dateFormat.format(new Date(event.registration_deadline))}`
          : null
      ].filter(Boolean);
      const organizerLinks = [
        event.contact_email ? `<a href="mailto:${escapeHtml(event.contact_email)}">Email organizer</a>` : null,
        event.contact_phone ? `<a href="tel:${escapeHtml(event.contact_phone)}">Call organizer</a>` : null,
        safeWebUrl(event.organizer_website) ? `<a href="${escapeHtml(safeWebUrl(event.organizer_website))}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : null,
        safeWebUrl(event.organizer_instagram) ? `<a href="${escapeHtml(safeWebUrl(event.organizer_instagram))}" target="_blank" rel="noopener noreferrer">Instagram ↗</a>` : null,
        safeWebUrl(event.organizer_x) ? `<a href="${escapeHtml(safeWebUrl(event.organizer_x))}" target="_blank" rel="noopener noreferrer">X ↗</a>` : null
      ].filter(Boolean);

      return `<article class="event-card">
        <div class="${bannerClass}"${bannerStyle}><span class="category-pill">${escapeHtml(event.category || "Event")}</span><span class="format-pill">${escapeHtml(String(event.format || "in_person").replace("_", " "))}</span></div>
        <div class="event-body">
          <span class="event-date">◷ ${escapeHtml(dateText)}</span>
          <h3 class="event-title">${escapeHtml(event.title)}</h3>
          ${event.organizer_name ? `<p class="event-organizer">Hosted by ${escapeHtml(event.organizer_name)}</p>` : ""}
          <p class="event-description">${escapeHtml(event.description || "Join us for a great experience. More event details will be shared by the organizer.")}</p>
          <p class="event-venue"><span>⌖</span>${escapeHtml(event.venue || (event.format === "online" ? "Online event" : "Venue to be announced"))}</p>
          ${details.length ? `<div class="event-meta">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</div>` : ""}
          ${ticketRows}
          ${purchaseAction}
          ${organizerLinks.length ? `<div class="organizer-contact">${organizerLinks.join("")}</div>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  async function loadEvents() {
    if (!client) {
      showNotice("Add your Supabase project URL and public anon key in supabase-config.js to load published events.", true);
      return;
    }

    showNotice("Loading upcoming events…");
    try {
      const { data: events, error: eventsError } = await client
        .from("events")
        .select("id, title, description, category, format, venue, banner_url, capacity, registration_deadline, organizer_name, contact_email, contact_phone, organizer_website, organizer_instagram, organizer_x, starts_at")
        .eq("status", "published")
        .eq("visibility", "public")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true });
      if (eventsError) throw eventsError;

      const eventList = events || [];
      let ticketsByEvent = new Map();
      if (eventList.length) {
        const { data: ticketTypes, error: ticketsError } = await client
          .from("ticket_types")
          .select("id, event_id, name, description, price, sales_start, sales_end")
          .in("event_id", eventList.map((event) => event.id))
          .order("price", { ascending: true });
        if (ticketsError) throw ticketsError;
        ticketsByEvent = new Map(eventList.map((event) => [
          event.id,
          (ticketTypes || []).filter((ticket) => ticket.event_id === event.id)
        ]));
      }

      renderEvents(eventList, ticketsByEvent);
      notice.classList.add("hidden");
    } catch (error) {
      if (explainDatabaseError(error).includes("Supabase is missing public.events")) {
        showMissingEventsSetup();
      } else {
        showNotice(`Could not load events from Supabase: ${explainDatabaseError(error)}`, true);
      }
    }
  }

  loadEvents();
})();
