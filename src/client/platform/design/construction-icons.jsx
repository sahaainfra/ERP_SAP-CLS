// The construction glyphs of the icon registry (part 03.01, FR-05): original line drawings on the same 24 px grid and 1.75 px stroke
// as the outline set, so they sit beside it without looking borrowed. Each is the inside of an <svg viewBox="0 0 24 24">.

export const CONSTRUCTION_GLYPHS = {
  // bill of quantities: a sheet with item rows and a rate column
  'erp.cx.boq': (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M4 8h16M4 12.5h16M4 17h16M14 8v13" />
    </>
  ),
  // measurement book: a bound book with a scale along its edge
  'erp.cx.measurement-book': (
    <>
      <path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M8 3v18M18 7h-2.5M18 10h-1.5M18 13h-2.5M18 16h-1.5" />
    </>
  ),
  // daily progress report: a page with a sun and a rising line
  'erp.cx.dpr': (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <circle cx="9" cy="8" r="2" />
      <path d="M7 18l3.5-3.5 2.5 2 4-4.5" />
    </>
  ),
  // work authorisation: a page with a stamp mark
  'erp.cx.work-authorisation': (
    <>
      <path d="M14 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V8.5Z" />
      <path d="M14 3v5.5h5.5" />
      <circle cx="12" cy="14.5" r="3" />
      <path d="M10.8 14.5l.9.9 1.6-1.8" />
    </>
  ),
  // permit to work: a tag with a hole and a tick
  'erp.cx.permit-to-work': (
    <>
      <path d="M5 4h9l5 5v10.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5Z" />
      <circle cx="9" cy="8" r="1.2" />
      <path d="M8.5 15l2.2 2.2 4.8-5" />
    </>
  ),
  // transit mixer: a truck carrying a tilted drum
  'erp.cx.transit-mixer': (
    <>
      <path d="M3 16V12h4l2-3h3" />
      <path d="M11 8.5l8.5-2.5 1.5 5-8.5 2.5Z" />
      <path d="M3 16h18" />
      <circle cx="6.5" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  // batching plant: a silo on legs over a hopper
  'erp.cx.batching-plant': (
    <>
      <path d="M8 3h8v8l-4 3-4-3Z" />
      <path d="M12 14v3M7 21l2-6M17 21l-2-6M4 21h16" />
    </>
  ),
  // tower crane: mast, jib and a hanging hook
  'erp.cx.crane': (
    <>
      <path d="M7 21V5M4 21h6M7 5l-3 3h17M7 5l3 3M16 8v5" />
      <path d="M14.5 13h3l-1 2.5h-1Z" />
    </>
  ),
  // formwork: shuttering panels held by props
  'erp.cx.formwork': (
    <>
      <path d="M3 8h18M3 11h18" />
      <path d="M6 11l-2 10M10 11l1 10M14 11l-1 10M18 11l2 10M4.5 17h15" />
    </>
  ),
  // reinforcement: bent bars with ribs
  'erp.cx.rebar': (
    <>
      <path d="M4 19V8a3 3 0 0 1 3-3h13" />
      <path d="M8 19V11a2 2 0 0 1 2-2h10" />
      <path d="M3 13h2M3 16h2M12 4v2M16 4v2" />
    </>
  ),
  // pour card: a card with a bucket of concrete
  'erp.cx.pour-card': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M8 9h8l-1.5 6h-5Z" />
      <path d="M11 15v2M13 15v2" />
    </>
  ),
  // gate pass: a ticket with a barrier arm
  'erp.cx.gate-pass': (
    <>
      <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4Z" />
      <path d="M8 12h8M14 10l2 2-2 2" />
    </>
  ),
  // safety helmet
  'erp.cx.hard-hat': (
    <>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="M3 16h18v2.5H3ZM10 8.5V6h4v2.5" />
    </>
  ),
  // survey point: a tripod under a crosshair
  'erp.cx.survey-point': (
    <>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M12 2.5v9M7.5 7h9M12 10.5L7 21M12 10.5l5 10.5M12 10.5V21" />
    </>
  ),
};
