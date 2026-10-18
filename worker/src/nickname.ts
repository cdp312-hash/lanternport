// Nickname rules: 3-20 characters, letters, numbers, spaces, - and _, starting with a letter or number.
// A short block list keeps the leaderboard friendly; it's deliberately simple, so there's also
// a reserved list for names that could be mistaken for the site itself.

const BLOCKED = [
  "fuck", "shit", "cunt", "bitch", "bastard", "wank", "twat", "prick", "dick", "cock", "pussy", "slut", "whore",
  "nigg", "fag", "retard", "nazi", "hitler", "rape", "porn", "sex",
];
const RESERVED = ["admin", "moderator", "lanternport", "ledger", "official", "support", "system", "staff"];

export function nicknameKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

/** Returns the tidied nickname, or an error message to show the player. */
export function checkNickname(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Choose a nickname." };
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 20) return { error: "Nicknames are 3 to 20 characters." };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) {
    return { error: "Use letters, numbers, spaces, - and _ only, starting with a letter or number." };
  }
  const key = nicknameKey(name);
  // Also catch common letter-for-number swaps.
  const plain = key.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  if (BLOCKED.some((w) => key.includes(w) || plain.includes(w))) return { error: "Please choose a friendlier nickname." };
  if (RESERVED.some((w) => key.includes(w))) return { error: "That nickname is reserved. Please choose another." };
  return { name };
}
