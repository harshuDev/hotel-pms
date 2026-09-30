/*
 * What LOAD DEFAULTS puts in the two editors on Settings -> Other ->
 * Templates (0105): the built-in invoice, written as a Liquid template, so a
 * hotel starts from the layout it already prints rather than a blank page.
 * `TEMPLATE_VARIABLES` is what the help popover lists; it and
 * `invoiceLiquidData()` in `invoice-data.ts` change together.
 */

export const DEFAULT_FOLIO_LIQUID = `<div class="invoice">
  <header class="head">
    <div>
      {% if hotel.logo_url != "" %}<img class="logo" src="{{ hotel.logo_url }}" alt="{{ hotel.name }}">{% endif %}
      {% if hotel.logo_text != "" %}<p class="logo-text">{{ hotel.logo_text }}</p>{% endif %}
      <p class="issuer">{{ hotel.name }}</p>
      {% if hotel.address != "" %}<p class="muted">{{ hotel.address }}</p>{% endif %}
      <p class="muted">{{ hotel.phone }}{% if hotel.phone != "" and hotel.email != "" %} · {% endif %}{{ hotel.email }}</p>
    </div>
    <div class="right">
      <p class="title">Invoice</p>
      {% if invoice.number != "" %}<p>No. {{ invoice.number }}</p>{% endif %}
      <p class="muted">{{ invoice.reference }}</p>
      <p class="muted">{{ invoice.date }}</p>
    </div>
  </header>

  <section class="parties">
    <div>
      <p class="label">Bill to</p>
      <p>{{ guest.name }}</p>
      {% if guest.email != "" %}<p class="muted">{{ guest.email }}</p>{% endif %}
      {% if guest.phone != "" %}<p class="muted">{{ guest.phone }}</p>{% endif %}
    </div>
    <div class="right">
      <p class="label">Stay</p>
      <p>{{ stay.check_in }} – {{ stay.check_out }}</p>
      <p class="muted">{{ stay.rooms }}</p>
    </div>
  </section>

  <table class="lines">
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        {% if invoice.show_room %}<th>Room</th>{% endif %}
        {% if invoice.vat_registered %}<th class="num">Net</th><th class="num">VAT</th>{% endif %}
        <th class="num">{% if invoice.vat_registered %}Total{% else %}Amount{% endif %}</th>
      </tr>
    </thead>
    <tbody>
      {% for line in lines %}
      <tr>
        <td class="nowrap">{{ line.date }}</td>
        <td>{{ line.description }}</td>
        {% if invoice.show_room %}<td>{{ line.room }}</td>{% endif %}
        {% if invoice.vat_registered %}<td class="num">{{ line.net }}</td><td class="num">{{ line.tax }}</td>{% endif %}
        <td class="num">{{ line.amount }}</td>
      </tr>
      {% else %}
      <tr><td colspan="6" class="empty">Nothing charged yet.</td></tr>
      {% endfor %}
    </tbody>
  </table>

  <section class="totals">
    {% if invoice.vat_registered %}
    <div class="row muted"><span>Net</span><span>{{ totals.net }}</span></div>
    {% for t in taxes %}
    <div class="row muted"><span>{{ t.name }}</span><span>{{ t.amount }}</span></div>
    {% else %}
    <div class="row muted"><span>VAT</span><span>{{ totals.tax }}</span></div>
    {% endfor %}
    {% endif %}
    <div class="row total"><span>Total</span><span>{{ totals.total }}</span></div>
    {% if payments.size > 0 %}<p class="label">Paid</p>{% endif %}
    {% for p in payments %}
    <div class="row muted"><span>{{ p.description }}{% if p.reversed %} (reversed){% endif %}, {{ p.date }}</span><span>{{ p.amount }}</span></div>
    {% endfor %}
    <div class="row balance"><span>Balance due</span><span>{{ totals.balance }}</span></div>
  </section>

  {% if invoice.notes != "" %}<p class="notes">{{ invoice.notes | escape | newline_to_br | raw }}</p>{% endif %}
</div>
`;

export const DEFAULT_FOLIO_CSS = `.invoice { max-width: 48rem; margin: 0 auto; padding: 2rem; background: #fff; color: #0f172a; font: 13px/1.45 system-ui, sans-serif; }
.invoice p { margin: 0; }
.head { display: flex; justify-content: space-between; gap: 1.5rem; border-bottom: 2px solid #0f172a; padding-bottom: 1rem; }
.logo { max-height: 5rem; max-width: 16rem; margin-bottom: .75rem; }
.logo-text { font-size: 22px; font-weight: 600; margin-bottom: .5rem; }
.issuer { font-size: 14px; font-weight: 600; }
.title { font-size: 20px; font-weight: 600; }
.right { text-align: right; }
.muted { color: #64748b; }
.label { margin-top: .5rem; font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #94a3b8; }
.parties { display: flex; justify-content: space-between; gap: 1.5rem; margin-top: 1.25rem; }
.lines { width: 100%; margin-top: 1.5rem; border-collapse: collapse; }
.lines th { padding: .5rem; text-align: left; font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #94a3b8; border-bottom: 1px solid #e2e8f0; }
.lines td { padding: .375rem .5rem; border-bottom: 1px solid #eef2f7; }
.num { text-align: right !important; font-variant-numeric: tabular-nums; }
.nowrap { white-space: nowrap; }
.empty { padding: 1.5rem; text-align: center; color: #64748b; }
.totals { width: 100%; max-width: 20rem; margin: 1rem 0 0 auto; }
.row { display: flex; justify-content: space-between; padding: .125rem 0; font-variant-numeric: tabular-nums; }
.total { border-top: 1px solid #e2e8f0; padding: .25rem 0; font-weight: 600; }
.balance { margin-top: .25rem; border-top: 2px solid #0f172a; padding: .25rem 0; font-weight: 600; }
.notes { margin-top: 2rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; color: #64748b; }
@media print { .invoice { padding: 0; } }
`;

export const TEMPLATE_VARIABLES: { name: string; items: string[] }[] = [
  { name: "hotel", items: ["name", "address", "phone", "email", "logo_url", "logo_text"] },
  {
    name: "invoice",
    items: ["number", "reference", "date", "date_iso", "vat_registered", "show_room", "notes", "currency"],
  },
  { name: "guest", items: ["name", "email", "phone"] },
  { name: "stay", items: ["check_in", "check_out", "check_in_iso", "check_out_iso", "rooms"] },
  {
    name: "lines[]",
    items: ["date", "date_iso", "description", "room", "net", "tax", "amount", "net_cents", "tax_cents", "amount_cents"],
  },
  { name: "taxes[]", items: ["name", "amount", "amount_cents"] },
  { name: "payments[]", items: ["date", "date_iso", "description", "amount", "amount_cents", "reversed"] },
  {
    name: "totals",
    items: ["net", "tax", "total", "balance", "net_cents", "tax_cents", "total_cents", "balance_cents"],
  },
];
