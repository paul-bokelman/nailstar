// P0.1: base64 image blocks via stream-json input, --json-schema structured output, zod validation,
// and the token cost of a 1536×864 image.
// Run: bun spikes/provider/03-images-schema.ts
import { z } from "zod";
import { callClaude, summary } from "./lib";

const fx = `${import.meta.dir}/fixtures`;
const iso = ["--safe-mode", "--setting-sources", ""];
const system = "You read images precisely. Answer only from what you see.";

const Probe = z.object({
  images: z.array(z.object({
    index: z.number().int(),
    code: z.string().describe("the large white text exactly as written"),
    shapes: z.string().describe("count, colour and kind of the shapes"),
  })),
});
const schema = z.toJSONSchema(Probe, { target: "draft-7" });
console.log("schema $schema:", (schema as any)["$schema"]);

const cases: Record<string, any> = {
  textOnly: { content: [{ type: "text", text: "There are no images. Return images: []." }] },
  oneImage: { content: [{ type: "image", path: `${fx}/probe-a.png` }, { type: "text", text: "Describe image 1." }] },
  twoImages: {
    content: [
      { type: "text", text: "Image 1:" }, { type: "image", path: `${fx}/probe-a.png` },
      { type: "text", text: "Image 2:" }, { type: "image", path: `${fx}/probe-b.png` },
      { type: "text", text: "Describe both images." },
    ],
  },
};

const out: Record<string, any> = {};
for (const [name, c] of Object.entries(cases)) {
  const r = await callClaude({ system, content: c.content, schema, extraArgs: iso });
  const so = r.result?.structured_output;
  const parsed = Probe.safeParse(so);
  out[name] = {
    ...summary(r),
    resultKeys: r.result ? Object.keys(r.result) : null,
    hasStructuredOutput: so !== undefined,
    structuredOutput: so,
    zodOk: parsed.success,
    resultTextLooksJson: (() => { try { JSON.parse(r.result?.result); return true; } catch { return false; } })(),
  };
  console.log(name, JSON.stringify(out[name]));
}
await Bun.write(`${import.meta.dir}/out/03-images-schema.json`, JSON.stringify(out, null, 2));
