# Runbook: renew the TLS certificate

**Automatic:** certbot renews twice a day from cron (infra/ansible/site.yml) and reloads nginx; the alert *ErpCertificateExpiring* fires 14 days before expiry if it did not.

When the alert fires:
1. On the host: `certbot renew --dry-run` — read the error (DNS, port 80 blocked, rate limit).
2. Fix the cause (open port 80 for the challenge, correct the DNS record), then `certbot renew` and `docker compose exec nginx nginx -s reload`.
3. Check from outside: `curl -vI https://<host>` shows the new expiry date.
4. If the certificate cannot be renewed before expiry, buy one from the commercial CA on record and install it at the same paths; record it.
