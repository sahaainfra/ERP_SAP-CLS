import { parseSettings } from './validators.js';

export function createSettingsController(service) {
  return {
    get(req, res) {
      res.json({ data: service.get(req.actor) });
    },
    display(req, res) {
      res.json({ data: service.display(req.actor) });
    },
    save(req, res) {
      res.json({ data: service.save(req.actor, parseSettings(req.body), req.correlationId) });
    },
  };
}
