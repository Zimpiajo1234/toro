/** Completion headings. Always positive, never a judgement of speed. */
export const POSITIVE_MESSAGES: readonly string[] = [
  'Buen trabajo',
  'Almacén organizado',
  'Perfectamente colocado',
  'Todo en su sitio',
  '¡Qué orden tan agradable!',
];

/** Picks a random message, never the same one twice in a row. */
export class MessagePicker {
  private readonly messages: readonly string[];
  private readonly random: () => number;
  private lastIndex = -1;

  constructor(messages: readonly string[] = POSITIVE_MESSAGES, random: () => number = Math.random) {
    this.messages = messages;
    this.random = random;
  }

  next(): string {
    const n = this.messages.length;
    if (n === 0) return '';
    if (n === 1) return this.messages[0];
    // Draw among the candidates that exclude the previous pick, then step over it.
    const pool = this.lastIndex < 0 ? n : n - 1;
    let i = Math.floor(this.random() * pool);
    i = i < 0 ? 0 : i >= pool ? pool - 1 : i;
    if (this.lastIndex >= 0 && i >= this.lastIndex) i++;
    this.lastIndex = i;
    return this.messages[i];
  }
}
