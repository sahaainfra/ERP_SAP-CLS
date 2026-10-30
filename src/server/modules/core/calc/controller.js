import {
  parseActivation, parseCode, parseCompare, parseConversionCreate, parseConversionList, parseConvert, parseCreateFormula, parseCreateVersion, parseFormulaList, parseId,
  parseReasonBody, parseShadowSummary, parseTest, parseTraceQuery, parseUomCreate, parseUpdateVersion, parseVersion,
} from './validators.js';

export function createCalcController(service) {
  return {
    list: (req, res) => res.json(service.list(req.actor, parseFormulaList(req.query))),
    get: (req, res) => res.json({ data: service.get(req.actor, parseCode(req.params.code)) }),
    create: (req, res) => res.status(201).json({ data: service.createFormula(req.actor, parseCreateFormula(req.body), req.correlationId) }),
    createVersion: (req, res) => res.status(201).json({ data: service.createVersion(req.actor, parseCode(req.params.code), parseCreateVersion(req.body ?? {}), req.correlationId) }),
    updateVersion: (req, res) => res.json({ data: service.updateVersion(req.actor, parseCode(req.params.code), parseVersion(req.params.version), parseUpdateVersion(req.body), req.correlationId) }),
    check: (req, res) => res.json({ data: service.checkVersion(req.actor, parseCode(req.params.code), parseVersion(req.params.version)) }),
    test: (req, res) => res.json({ data: service.test(req.actor, parseCode(req.params.code), parseTest(req.body)) }),
    startShadow: (req, res) => res.json({ data: service.startShadow(req.actor, parseCode(req.params.code), parseVersion(req.params.version), parseReasonBody(req.body), req.correlationId) }),
    stopShadow: (req, res) => res.json({ data: service.stopShadow(req.actor, parseCode(req.params.code), parseVersion(req.params.version), parseReasonBody(req.body), req.correlationId) }),
    requestActivation: (req, res) => res.status(201).json({ data: service.requestActivation(req.actor, parseCode(req.params.code), parseVersion(req.params.version), parseActivation(req.body)) }),
    compare: (req, res) => res.json({ data: service.compare(req.actor, parseCode(req.params.code), parseCompare(req.body)) }),
    shadowSummary: (req, res) => res.json({ data: service.shadowSummary(req.actor, parseCode(req.params.code), parseShadowSummary(req.query)) }),
    traces: (req, res) => res.json({ data: service.traces(req.actor, parseTraceQuery(req.query)) }),
    uoms: (req, res) => res.json({ data: service.listUoms(req.actor) }),
    createUom: (req, res) => res.status(201).json({ data: service.createUom(req.actor, parseUomCreate(req.body), req.correlationId) }),
    conversions: (req, res) => res.json({ data: service.listConversions(req.actor, parseConversionList(req.query)) }),
    createConversion: (req, res) => res.status(201).json({ data: service.createConversion(req.actor, parseConversionCreate(req.body), req.correlationId) }),
    removeConversion: (req, res) => res.json({ data: service.removeConversion(req.actor, parseId(req.params.id), req.correlationId) }),
    convert: (req, res) => res.json({ data: service.convert(req.actor, parseConvert(req.body)) }),
  };
}
