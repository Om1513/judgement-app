// Generate unique 6-character alphanumeric lobby codes

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;

/**
 * Generates a random 6-character uppercase alphanumeric lobby code.
 * Uses cryptographically random values for better randomness.
 */
export function generateLobbyCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * CHARS.length);
    code += CHARS[randomIndex];
  }
  return code;
}

/**
 * Generates a unique lobby code that doesn't exist in the database.
 * Retries up to maxAttempts times if collision occurs.
 */
export async function generateUniqueLobbyCode(
  existingCodes: Set<string> | string[],
  maxAttempts: number = 10
): Promise<string> {
  const codes = existingCodes instanceof Set ? existingCodes : new Set(existingCodes);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateLobbyCode();
    if (!codes.has(code)) {
      return code;
    }
  }

  // If we've exhausted attempts, throw an error
  throw new Error('Failed to generate unique lobby code after maximum attempts');
}

/**
 * Validates that a lobby code follows the expected format.
 */
export function isValidLobbyCode(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }

  if (code.length !== CODE_LENGTH) {
    return false;
  }

  // Check if all characters are valid (uppercase alphanumeric)
  const validCodeRegex = /^[A-Z0-9]{6}$/;
  return validCodeRegex.test(code);
}
