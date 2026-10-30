export function createAboutController(service) {
  return {
    show(req, res) {
      res.json({ data: service.about(req.actor) });
    },
  };
}
