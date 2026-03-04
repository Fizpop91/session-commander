## Email Notifications

Email notifications are configured in **Settings → Notifications**.

You can set:

- SMTP host, port, and secure mode (`SSL`)
- SMTP username/password (optional for servers that allow unauthenticated relay)
- From address and recipient address(es)
- Notification preferences for:
  - Successful transfers/session creation
  - Failed transfers

You can also send a test email from the Notifications tab, and clear notification config (including any stored SMTP password)

**Storage and encryption details**

- Notification settings are stored separately from setup config in `data/notifications.json`
- The SMTP password is never stored in plain text; it is encrypted and stored in `data/notification-secrets.enc` and uses `AES-256-GCM` encryption
- The encryption key is loaded from `SESSION_COMMANDER_SECRET_KEY` (if set), or generated/stored at `data/secrets.key`

Because notifications are in separate files, restoring a saved setup config does not automatically restore SMTP notification settings.
