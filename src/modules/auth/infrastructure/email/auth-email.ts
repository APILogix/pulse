/** Auth module email transport (sync SMTP or Postgres outbox). */
import { sendAuthEmail } from './email-outbox.js';

export const authEmail = {
  send: sendAuthEmail,
};
