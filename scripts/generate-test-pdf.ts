import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUTPUT = new URL("../test-data/sample-campaign.pdf", import.meta.url).pathname;

async function main() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 72;
  const LINE_HEIGHT = 16;

  function addPage(sections: { title: string; body: string }[]) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    for (const { title, body } of sections) {
      // Section heading
      page.drawText(title, { x: MARGIN, y, font: bold, size: 14, color: rgb(0.2, 0.1, 0.05) });
      y -= LINE_HEIGHT * 1.5;

      // Body text — wrap manually
      const words = body.split(" ");
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, 11) > PAGE_W - 2 * MARGIN) {
          page.drawText(line, { x: MARGIN, y, font, size: 11 });
          y -= LINE_HEIGHT;
          line = word;
        } else {
          line = test;
        }
      }
      if (line) {
        page.drawText(line, { x: MARGIN, y, font, size: 11 });
        y -= LINE_HEIGHT * 2;
      }
    }
  }

  // --- Page 1 ---
  addPage([
    {
      title: "The Sunken Temple — A D&D 5e Campaign",
      body: "Deep beneath the Verdant Marshes lies an ancient temple dedicated to Thalassor, a forgotten god of tides and secrets. For centuries, the temple has been submerged, its corridors flooded and its treasures lost. Recently, tremors have partially drained the swamp, revealing the temple's uppermost spire. Adventurers from across the realm have been drawn to the site, but none have returned.",
    },
    {
      title: "Adventure Hook",
      body: "The party is hired by Elder Miravel of Fenwick Village to investigate the disappearance of three scouts sent to explore the newly exposed ruins. Miravel suspects the temple's emergence is connected to the strange blight affecting crops in the surrounding farmland. She offers 500 gold pieces and access to the village's ancestral armory.",
    },
    {
      title: "Key NPCs",
      body: "Elder Miravel (LG human cleric, level 8) — village leader and keeper of old lore. She carries a silver holy symbol that glows faintly near the temple. Grak the Unbroken (CN half-orc barbarian, level 6) — a former adventurer who explored the upper ruins and lost his left hand to a trap. He can provide a partial map. Sylphira (NE tiefling warlock, level 7) — a rival treasure hunter who arrived two days before the party. She secretly serves a patron connected to Thalassor.",
    },
    {
      title: "Key Locations",
      body: "Fenwick Village — a small farming settlement of 200 souls on the edge of the Verdant Marshes. The Drowned Causeway — a crumbling stone path leading from solid ground into the swamp toward the temple. Partially submerged, it is guarded by giant frogs and swamp trolls. The Spire of Tides — the only visible part of the temple above the waterline. Its interior contains a spiral staircase descending into darkness.",
    },
  ]);

  // --- Page 2 ---
  addPage([
    {
      title: "Temple Level 1: The Flooded Nave",
      body: "The first level of the temple is partially flooded with brackish water reaching waist height. The nave stretches 60 feet long and 30 feet wide, with broken pews and collapsed columns. A DC 14 Perception check reveals carvings on the walls depicting Thalassor commanding great waves. Two water weirds lurk in the deeper pools near the altar. Behind the altar, a locked iron door (DC 16 Thieves' Tools) leads to the Lower Sanctum.",
    },
    {
      title: "Temple Level 2: The Lower Sanctum",
      body: "Below the nave, the sanctum is dry but filled with stale air. Three chambers branch off a central corridor. The Chamber of Echoes contains a puzzle — speaking the name of Thalassor in Primordial opens a hidden passage. The Reliquary holds minor magic items: a Driftwood Staff (+1 quarterstaff, can cast Shape Water at will) and a Tidecaller's Amulet (advantage on saves vs. water-based effects). The Throne Room contains the campaign's main antagonist.",
    },
    {
      title: "Boss Encounter: The Drowned Prophet",
      body: "The Drowned Prophet is a corrupted priest of Thalassor who has been kept alive for centuries by dark magic. Use the stat block of a wraith with the following modifications: +2 AC from barnacle-encrusted armor, resistance to cold damage, and a Lair Action that floods the room by 1 foot per round (max 5 feet). At 3 feet of water, medium creatures have disadvantage on melee attacks. The Prophet guards the Tear of Thalassor, a sapphire gemstone worth 2,000 gp that is also the source of the crop blight.",
    },
    {
      title: "Rewards and Conclusion",
      body: "Defeating the Drowned Prophet and returning the Tear of Thalassor to Elder Miravel lifts the blight and earns the party their promised reward. Miravel also grants them the title Wardens of the Marsh, giving them advantage on Charisma checks with locals. If the party kept the Tear, they gain a powerful item but the blight worsens — setting up a future adventure hook. Total XP: approximately 4,500 per character for a party of four level 5 adventurers.",
    },
  ]);

  mkdirSync(dirname(OUTPUT), { recursive: true });
  const bytes = await pdf.save();
  writeFileSync(OUTPUT, bytes);
  console.log(`Generated: ${OUTPUT} (${bytes.byteLength} bytes)`);
}

main();
