// Prints the НСИ name of ATC codes or every code that begins with a prefix (debug aid for SRCH1).
//   bun tools/benchmarks/src/probe-atc-names.ts C07 "prefix:R03" …
import atcNames from '../../../apps/app/src/features/medications/atc-names.json';

const names = (atcNames as { names: Record<string, string> }).names;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('prefix:')) {
    const prefix = arg.slice(7);
    for (const [code, name] of Object.entries(names)) {
      if (code.startsWith(prefix)) console.log(`${code}\t${name}`);
    }
  } else {
    console.log(`${arg}\t${names[arg] ?? '— not in the dictionary'}`);
  }
}
