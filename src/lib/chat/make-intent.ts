/**
 * Does a chat message ask Fuobe to make something (a picture, a clip, a song), not to talk about it? Pure and
 * deliberately careful: a message only becomes a plan when it opens with a making verb and names something that can be
 * made, or edits or animates a picture sent with it. Everything else stays a conversation.
 */

const POLITE = String.raw`(?:(?:hey|hi|ok|okay|so|now|great|nice|cool|please|pls|fuobe)[,!.]?\s+)*(?:(?:can|could|would|will) you\s+|i(?:'d| would) like (?:you )?to\s+|i want (?:you )?to\s+|i need (?:you )?to\s+|let'?s\s+|go ahead and\s+|help me\s+)?(?:please\s+)?`;

const MAKE_VERBS = String.raw`(?:make|create|generate|render|draw|design|paint|illustrate|shoot|film|produce|compose|record|animate|give me|show me|do)`;

/** Things that can be made: a picture, a clip, a sound. */
const MADE = /\b(images?|pictures?|pics?|photos?|photographs?|portraits?|headshots?|selfies?|shots?|stills?|posters?|covers?|logos?|thumbnails?|banners?|wallpapers?|illustrations?|drawings?|paintings?|renders?|mockups?|lookbook|flat ?lay|product shots?|videos?|clips?|reels?|ads?|commercials?|trailers?|animations?|films?|footage|teasers?|storyboards?|songs?|tracks?|music|beats?|jingles?|soundtracks?|voice ?-?overs?|narrations?|sound effects?|sfx|3d models?|characters? sheets?)\b/;

/** Edits that need a picture sent with the message. */
const EDIT = /^(?:remove|erase|change|replace|swap|restyle|relight|recolou?r|upscale|enhance|sharpen|extend|outpaint|crop|fix|retouch|turn|put|add|make (?:it|this|her|him|them)|animate|bring (?:it|this) to life)\b/;

const START = new RegExp(`^${POLITE}${MAKE_VERBS}\\b`, "i");

/** Words that make it a conversation about making, not a request to make ("how do I make a reel?"). */
const TALK = /^(?:how|what|why|when|where|which|who|should|is|are|do|does|can i|could i|tips|ideas?|explain|tell me|write|draft|brainstorm|suggest|help me (?:think|plan|write|decide))\b/i;

export function wantsToMake(text: string, hasPicture = false): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return false;
  if (TALK.test(t) && !/^(?:can|could|would|will) you (?:please )?(?:make|create|generate|render|draw|design|animate)\b/.test(t)) return false;
  const stripped = t.replace(new RegExp(`^${POLITE}`, "i"), "");
  if (hasPicture && EDIT.test(stripped)) return true;
  if (!START.test(t)) return false;
  if (/^animate\b/.test(stripped)) return hasPicture || MADE.test(t);
  return MADE.test(t);
}
