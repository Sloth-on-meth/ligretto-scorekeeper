// Pure parser for pasted score tables. Kept free of React so it can be unit-tested.

export interface ParsedImportGame {
  playerNames: string[];
  rounds: { scores: { player_name: string; score: number }[] }[];
  delimiterLabel: string;
}

const DELIMITERS: { char: string; label: string }[] = [
  { char: '\t', label: 'tab' },
  { char: ';', label: 'semicolon' },
  { char: ',', label: 'comma' },
];

/**
 * Parses pasted scores. The first line holds player names; each following line is one round.
 * Tabs, semicolons and commas are all accepted, chosen from the header row.
 */
export function parseImportedGame(text: string): ParsedImportGame {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('Paste a header row of player names and at least one row of scores.');
  }

  const delimiter = DELIMITERS.find(d => lines[0].includes(d.char)) ?? DELIMITERS[0];
  const split = (line: string) => line.split(delimiter.char).map(cell => cell.trim().replace(/^"(.*)"$/, '$1'));

  const playerNames = split(lines[0]).filter(Boolean);
  if (playerNames.length < 2) {
    throw new Error('The header row needs at least 2 player names, separated by tabs, commas or semicolons.');
  }
  if (new Set(playerNames.map(n => n.toLowerCase())).size !== playerNames.length) {
    throw new Error('Player names in the header must be unique.');
  }

  const rounds = lines.slice(1).map((line, index) => {
    const cells = split(line);
    if (cells.length !== playerNames.length) {
      throw new Error(`Row ${index + 1} has ${cells.length} values; expected ${playerNames.length} (one per player).`);
    }

    return {
      scores: cells.map((cell, cellIndex) => {
        if (!/^[-+]?\d+$/.test(cell)) {
          throw new Error(`Row ${index + 1}: “${cell || 'empty'}” for ${playerNames[cellIndex]} is not a whole number.`);
        }
        return { player_name: playerNames[cellIndex], score: Number(cell) };
      }),
    };
  });

  return { playerNames, rounds, delimiterLabel: delimiter.label };
}
