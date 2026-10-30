import { parseCalendarCreate, parseCalendarUpdate, parseCheck, parseHolidayCreate, parseHolidayUpdate, parseId, parseImport, parseRange } from './validators.js';

export function createHolidayController(service) {
  return {
    listCalendars: (req, res) => res.json({ data: service.listCalendars(req.actor) }),
    getCalendar: (req, res) => res.json({ data: service.getCalendar(req.actor, parseId(req.params.id), parseRange(req.query)) }),
    createCalendar: (req, res) => res.status(201).json({ data: service.createCalendar(req.actor, parseCalendarCreate(req.body), req.correlationId) }),
    updateCalendar: (req, res) => res.json({ data: service.updateCalendar(req.actor, parseId(req.params.id), parseCalendarUpdate(req.body), req.correlationId) }),
    addHoliday: (req, res) => res.status(201).json({ data: service.addHoliday(req.actor, parseId(req.params.id), parseHolidayCreate(req.body), req.correlationId) }),
    updateHoliday: (req, res) => res.json({ data: service.updateHoliday(req.actor, parseId(req.params.id), parseHolidayUpdate(req.body), req.correlationId) }),
    deleteHoliday: (req, res) => res.json({ data: service.deleteHoliday(req.actor, parseId(req.params.id), req.correlationId) }),
    importHolidays: (req, res) => res.json({ data: service.importHolidays(req.actor, parseId(req.params.id), parseImport(req.body).rows, req.correlationId) }),
    check: (req, res) => res.json({ data: service.check(req.actor, parseCheck(req.query)) }),
  };
}
