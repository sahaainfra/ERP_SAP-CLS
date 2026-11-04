# Open-source licence review: end-to-end secure messaging (part 05.03)

Status: **prepared, not approved.** The approval is a workflow in the application (Open-Source Licence Register, "Send the review for approval"): the system administrator sends it, the IT administrator approves first and the director (legal) last. Until that is done the application itself refuses to register a device, to start a secure conversation or to switch the policy on (`secureReady`, tested in `tests/secure-messaging.test.js`, "the gate"). Nothing here was approved by the author of the code.

## 1. Question
Which library may carry the end-to-end encryption of secure conversations, and under which obligations?

## 2. Options considered
| Option | Licence | Finding | Decision proposed |
|---|---|---|---|
| libsignal (Signal Protocol) | AGPL-3.0-only | Section 13 (remote network interaction): users who interact with the modified program over a network must be offered the complete corresponding source. Linking libsignal into the ERP server or its browser client makes the ERP a covered work. The company's ERP licence is not AGPL-compatible and the company does not intend to publish its source. | **Rejected** |
| Signal-Server (relay) | AGPL-3.0-only | Same network-copyleft duty. The relay is also not needed: the `sec` module is the relay and sees only ciphertext. | **Rejected** |
| @matrix-org/olm (Olm, Megolm) | Apache-2.0 | The permitted alternative of the brief. No source-offer duty; notice and NOTICE file if shipped. It is a WebAssembly build that would be a new dependency to ship and keep patched. | Not needed, **not used** (stays the fallback) |
| Platform WebCrypto API (browser and Node.js) composed in `src/shared/e2e.js` as protocol `erp-e2e-v1` | The primitives belong to the browser or Node.js; the composition is company code | No third-party code is added. No cryptographic primitive is written here: ECDSA and ECDH P-256, HKDF-SHA-256, AES-256-GCM and SHA-256 are the platform's own. | **Approved** (proposed) |

## 3. Obligations of the chosen option
- Keep this review and the register current; every new component enters the register as "to review" (the register's *Refresh from the project* reads `package.json` and the installed licences).
- The composition (not the primitives) was designed by the development team and is **not Signal**: it has no double ratchet. It needs an **independent cryptographic review** before it protects regulated or highly sensitive data (defect D-276). The brief's "audited library only" rule is met for primitives, not for the protocol.
- Copyleft components found by the scan stay "to review" until the director decides.

## 4. What approval changes in the application
On approval of the review the register shows: libsignal and Signal-Server **not allowed**, Olm **not used**, `erp-e2e-v1` **approved**, and every other component with a permissive licence (MIT, ISC, BSD, Apache, 0BSD, and similar) **approved**; copyleft or unknown licences stay **to review**. Only then can the secure messaging policy be proposed with "on" and approved by a second person.

## 5. Sign-off (made in the application, not here)
| Step | Role | Where |
|---|---|---|
| Sent | System administrator | Open-Source Licence Register |
| Approved | IT administrator | Approvals inbox |
| Approved | Director (legal) | Approvals inbox |
