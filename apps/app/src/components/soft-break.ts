/** After a «+», «/» or «-» that joins two words of a name, a line may break. */
const NAME_JOINTS = /(?<=[+/-])(?=[\p{L}\p{N}])/u;

/** The pieces of `text` between its name joints; a text without one is one piece. */
export function softBreakParts(text: string): readonly string[] {
  return text.split(NAME_JOINTS);
}
