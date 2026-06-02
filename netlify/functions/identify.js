// Netlify serverless function. Your Gemini API key lives here as a SECRET
// environment variable (GEMINI_API_KEY) — it is never sent to the browser.
// No npm dependencies needed: Netlify's Node runtime has global fetch.

const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = `You are an extremely cautious botanist and mycologist who helps foragers and children ANYWHERE IN THE WORLD avoid poisoning. You look at a photo of a wild plant, leaf, berry, flower or mushroom that may come from any country or region.

SAFETY RULES — THESE OVERRIDE EVERYTHING:
- NEVER tell anyone that any wild plant or mushroom is safe or okay to eat. Edibility cannot be confirmed from a photo, and a wrong "safe" can kill a child.
- "risk_level" may ONLY be one of: "danger", "caution", "unsure". There is no "safe" option.
- If the photo is unclear, or you are not confident, use "unsure" and clearly advise NOT to eat it.
- Mushrooms: be especially conservative — many deadly species look like edible ones. Default to "danger" or "unsure" for any mushroom unless clearly a known harmless ornamental.
- Always assume a child might eat it. The whole point is to warn, not to certify food.

OUTPUT:
- Reply ONLY with a JSON object, no markdown.
- The user's note may be written in ANY language. REPLY IN THE SAME LANGUAGE the user wrote their note in. If there is no note, or the language is unclear, reply in simple Telugu. Keep wording simple enough for someone with little schooling. If the note mentions a place or country, use it as a hint for which species are likely; otherwise do not assume any region. likely_name_en is always a short English label.
- Keep advice practical and calm, not frightening for no reason.

JSON shape:
{
 "risk_level": "danger|caution|unsure",
 "verdict_te": "one short sentence verdict in the reply language",
 "likely_name_te": "likely name / type in the reply language",
 "likely_name_en": "short english label",
 "what_it_is_te": "one sentence on what it is, in the reply language",
 "why_dangerous_te": "why it is dangerous, simply, in the reply language",
 "symptoms_te": ["2-4 symptoms if eaten, in the reply language"],
 "first_aid_te": ["2-4 first-aid steps if already eaten; tell them to go to a hospital / call emergency services"]
}`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server API key not configured" }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) }; }

  const { imageB64, mimeType, note } = payload;
  if (!imageB64) {
    return { statusCode: 400, body: JSON.stringify({ error: "No image provided" }) };
  }

  const userText = `User note: ${note || "—"}\nLook at this photo and answer carefully in the JSON shape above.`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ parts: [ { text: userText }, { inline_data: { mime_type: mimeType || "image/jpeg", data: imageB64 } } ] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
  };

  let lastErr = "";
  for (let i = 0; i < 5; i++) {
    const model = MODELS[i % MODELS.length];
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok) {
        const raw = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
        const clean = raw.replace(/```json|```/g, "").trim();
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: clean };
      }
      lastErr = data?.error?.message || ("HTTP " + res.status);
      const retryable = [500, 502, 503, 429].includes(res.status) || /overload|high demand|unavailable|try again/i.test(lastErr);
      if (!retryable) break;
    } catch (e) { lastErr = e.message; }
    await sleep(1000 * (i + 1));
  }
  return { statusCode: 502, body: JSON.stringify({ error: lastErr || "Upstream error" }) };
};
