import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createHolidayController } from './controller.js';

export function holidayRoutes(service, { idempotent }) {
  const c = createHolidayController(service);
  const r = Router();
  // Reading holidays needs no permission beyond signing in: attendance, scheduling and SLA screens all show them.
  r.get('/holiday-calendars', c.listCalendars);
  r.get('/holiday-calendars/:id', c.getCalendar);
  r.get('/holidays/check', c.check);
  r.get('/holidays', c.between);
  r.post('/holiday-calendars', requirePermission('core.holiday.configure'), idempotent, c.createCalendar);
  r.patch('/holiday-calendars/:id', requirePermission('core.holiday.configure'), idempotent, c.updateCalendar);
  r.post('/holiday-calendars/:id/holidays', requirePermission('core.holiday.configure'), idempotent, c.addHoliday);
  r.post('/holiday-calendars/:id/import', requirePermission('core.holiday.configure'), idempotent, c.importHolidays);
  r.patch('/holidays/:id', requirePermission('core.holiday.configure'), idempotent, c.updateHoliday);
  r.delete('/holidays/:id', requirePermission('core.holiday.configure'), c.deleteHoliday);
  return r;
}
