export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function passwordPolicyMessage(password: string): string | null {
  const length = Array.from(password.normalize("NFC")).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return "Use at least 8 characters for your password.";
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return "Use no more than 128 characters for your password.";
  }
  return null;
}
