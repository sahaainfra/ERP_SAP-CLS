#!/usr/bin/env node
// Makes the application's VAPID key pair for Web Push (part 03.06). Put the two values in the environment (see .env.example); keep the
// private key in the secrets manager and use the same pair on every instance, or phones subscribed through one instance get nothing from another.
import { makeVapidKeys } from '../src/server/platform/push/index.js';

const k = makeVapidKeys();
console.log(`PUSH_VAPID_PUBLIC_KEY=${k.publicKey}\nPUSH_VAPID_PRIVATE_KEY=${k.privateKey}`);
