// SPDX-License-Identifier: AGPL-3.0-or-later
// TIDO — the cheerful blue water-turtle. Carriers: fin + crest + ears + mouth.
//   - Shell is a HOOD behind the head, not a helmet enclosing it: bottom edges
//     at y=86, above the eye line, so the body covers it from the chest down.
//   - Plastron (cream belly) sits in the lower body only (cy=154), with no
//     central seam, keeping it clearly separate from the face zone.
//   - Eyes are round (r=13) with big pupils (r=7) and DOUBLE catchlights — a
//     primary upper-left and a secondary lower-right — for a wide-awake look.
//     Lid is `scaleY(0)` by default via CSS so the eye is OPEN at rest;
//     animations close it for blinks/sleeping.
//   - Proportions: body ellipse at cx=100 cy=128 rx=54 ry=52; eyes high at
//     cy=104 with cheeks at cy=124 and mouth at cy=132.
//
// Structure note: animated elements (#fin, #crest, #earL/R, #armL/R, #lidL/R,
// #pupilL/R, #mouth, eyes' catchlights/whites) live as direct children of
// #creature. #bodyGroup wraps only static body fills (so a future "breathe"
// scaleY on #bodyGroup doesn't conflict with any rotating child). Overlay
// props (#bubbles, #splash, #glasses, #notepad) live outside #creature, same
// convention as Musko's #zzz/#bang.
import './tido.css'

export const tido = `<svg id="avatar" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <g id="creature">
    <!-- Ground shadow -->
    <ellipse cx="100" cy="182" rx="42" ry="6.5" fill="#0e2937" opacity="0.12"/>

    <!-- Shell back HOOD: rounded dome BEHIND the head. Crest at (100,22);
         bottom edges at (52,86)/(148,86) — well above the eye line at y=104.
         Body (drawn next) covers the shell's lower portion in the chest
         region, so the shell silhouette reads as a hood, not a helmet. -->
    <path d="M52 86 Q40 30 100 22 Q160 30 148 86 Z" fill="#2d7a8a" stroke="#0e2937" stroke-width="4.5" stroke-linejoin="round"/>

    <!-- Shell highlight bands showing dome curvature -->
    <path d="M62 58 Q100 38 138 58" fill="none" stroke="#5fb4c4" stroke-width="3.5" stroke-linecap="round" opacity="0.9"/>
    <path d="M66 74 Q100 60 134 74" fill="none" stroke="#5fb4c4" stroke-width="2.2" stroke-linecap="round" opacity="0.55"/>

    <!-- Body (round, Musko-proportioned). Static visual layers only — no
         animated children inside, so a future breathe-scaleY on #bodyGroup
         can't conflict with anything. -->
    <g id="bodyGroup">
      <ellipse cx="100" cy="128" rx="54" ry="52" fill="#4ec6d0" stroke="#0e2937" stroke-width="4.5"/>
      <!-- Right-side subtle 3D shadow -->
      <path d="M138 88 A54 52 0 0 1 140 168 A54 52 0 0 0 138 88Z" fill="#2da0aa"/>
    </g>

    <!-- Plastron (cream belly): LOWER body only. No central seam. -->
    <ellipse cx="100" cy="154" rx="28" ry="22" fill="#f5e6a0" stroke="#0e2937" stroke-width="2.2"/>

    <!-- Fin on top of shell. Base at viewBox (100, 38), tip at (100, 18). -->
    <path id="fin" d="M92 38 L100 18 L108 38 Q100 33 92 38 Z" fill="#5fb4c4" stroke="#0e2937" stroke-width="3" stroke-linejoin="round"/>

    <!-- Crest (water droplet on forehead). Between fin (above) and eyes (below). -->
    <path id="crest" d="M100 74 C95 65 100 56 100 56 C100 56 105 65 100 74 Z" fill="#aeefff" stroke="#0e2937" stroke-width="2.2" stroke-linejoin="round"/>

    <!-- Small fin-ears on head sides -->
    <path id="earL" d="M58 96 C46 98 44 112 54 120 C62 114 64 104 58 96 Z" fill="#4ec6d0" stroke="#0e2937" stroke-width="4"/>
    <path id="earR" d="M142 96 C154 98 156 112 146 120 C138 114 136 104 142 96 Z" fill="#4ec6d0" stroke="#0e2937" stroke-width="4"/>

    <!-- LEFT EYE: round, big, bright with double catchlights -->
    <circle cx="80" cy="104" r="13" fill="#ffffff" stroke="#0e2937" stroke-width="2"/>
    <circle id="pupilL" cx="80" cy="106" r="7" fill="#1a2a3a"/>
    <!-- Primary catchlight (big upper-left — "wide-awake shine") -->
    <circle cx="76" cy="101" r="3" fill="#ffffff"/>
    <!-- Secondary catchlight (tiny lower-right — depth) -->
    <circle cx="84" cy="110" r="1.4" fill="#ffffff"/>
    <!-- Lid: scaleY(0) baseline via CSS so eye is OPEN at rest. -->
    <ellipse id="lidL" cx="80" cy="104" rx="13" ry="13" fill="#4ec6d0"/>
    <!-- Lashes: opacity 0 baseline, visible only in sleeping. -->
    <path id="lashL" d="M67 104 q13 9 26 0" fill="none" stroke="#0e2937" stroke-width="2.5" stroke-linecap="round"/>

    <!-- RIGHT EYE -->
    <circle cx="120" cy="104" r="13" fill="#ffffff" stroke="#0e2937" stroke-width="2"/>
    <circle id="pupilR" cx="120" cy="106" r="7" fill="#1a2a3a"/>
    <circle cx="116" cy="101" r="3" fill="#ffffff"/>
    <circle cx="124" cy="110" r="1.4" fill="#ffffff"/>
    <ellipse id="lidR" cx="120" cy="104" rx="13" ry="13" fill="#4ec6d0"/>
    <path id="lashR" d="M107 104 q13 9 26 0" fill="none" stroke="#0e2937" stroke-width="2.5" stroke-linecap="round"/>

    <!-- Cheek blush (slightly out from eyes) -->
    <ellipse cx="62" cy="124" rx="5.5" ry="3.5" fill="#ff9bb0"/>
    <ellipse cx="138" cy="124" rx="5.5" ry="3.5" fill="#ff9bb0"/>

    <!-- Mouth (small, slight smile — eager-curious) -->
    <ellipse id="mouth" cx="100" cy="132" rx="5" ry="3.5" fill="#7a3b32"/>
    <path d="M95 131 q5 -3 10 0" fill="none" stroke="#5a2820" stroke-width="1.3" stroke-linecap="round"/>

    <!-- Flippers (arms) -->
    <ellipse id="armL" cx="46" cy="142" rx="10" ry="14" fill="#4ec6d0" stroke="#0e2937" stroke-width="4.5"/>
    <ellipse id="armR" cx="154" cy="142" rx="10" ry="14" fill="#4ec6d0" stroke="#0e2937" stroke-width="4.5"/>
    <!-- Kelp blanket: teal-green fabric with wavy stripes evoking sea kelp.
         80px wide (slightly wider than Gato's to match Tido's rounder body),
         tapered sides + rounded bottom merging at y=176. Wave-pattern accents
         in shell-highlight teal #5fb4c4. Hidden until depth 2. -->
    <g id="blanket">
      <path d="M60 144 Q72 136 84 142 Q92 136 100 140 Q108 136 116 142 Q128 136 140 144 Q144 162 138 180 Q120 184 100 184 Q80 184 62 180 Q56 162 60 144 Z" fill="#e8a899" stroke="#0e2937" stroke-width="3.2" stroke-linejoin="round"/>
      <path d="M134 148 L140 146 Q144 162 138 180 L134 178 Q140 162 134 148 Z" fill="#c88878"/>
      <path d="M70 160 Q80 156 90 160 Q100 164 110 160 Q120 156 130 160" stroke="#a47868" stroke-width="1.6" opacity="0.7" fill="none" stroke-linecap="round"/>
      <path d="M70 174 Q80 170 90 174 Q100 178 110 174 Q120 170 130 174" stroke="#a47868" stroke-width="1.6" opacity="0.7" fill="none" stroke-linecap="round"/>
      <path d="M64 144 Q76 138 86 144" fill="none" stroke="#f5c8b8" stroke-width="1.5" opacity="0.75" stroke-linecap="round"/>
      <path d="M114 144 Q126 138 138 144" fill="none" stroke="#f5c8b8" stroke-width="1.5" opacity="0.75" stroke-linecap="round"/>
    </g>
    <!-- Kelp-leaf head prop with a dewdrop tip. Draped over the head crown
         (centered on top of the shell + fin area). Kelp ribs in deep teal
         echo the body outline. Hidden until depth 3. -->
    <g id="sleepcap">
      <path d="M74 28 Q86 8 100 6 Q114 8 118 28 Q108 32 96 32 Q84 32 78 28 Q74 26 74 28 Z" fill="#3a9b76" stroke="#0e2937" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M84 28 Q92 14 100 10" fill="none" stroke="#1f6244" stroke-width="1.4" opacity="0.7" stroke-linecap="round"/>
      <path d="M94 28 Q102 16 110 12" fill="none" stroke="#1f6244" stroke-width="1.2" opacity="0.6" stroke-linecap="round"/>
      <path d="M100 30 L100 8" stroke="#1f6244" stroke-width="1.4" opacity="0.6" stroke-linecap="round"/>
      <circle cx="100" cy="6" r="3" fill="#aeefff" stroke="#0e2937" stroke-width="1.4"/>
    </g>
  </g>

  <!-- Overlay props OUTSIDE #creature (display:none baseline). -->
  <g id="bubbles">
    <circle class="b1" cx="118" cy="120" r="3" fill="#aeefff" stroke="#0e2937" stroke-width="1.4"/>
    <circle class="b2" cx="126" cy="112" r="2.4" fill="#aeefff" stroke="#0e2937" stroke-width="1.2"/>
    <circle class="b3" cx="134" cy="104" r="2" fill="#aeefff" stroke="#0e2937" stroke-width="1.1"/>
  </g>

  <g id="splash">
    <circle class="s1" cx="60" cy="64" r="2.6" fill="#aeefff" stroke="#0e2937" stroke-width="1.3"/>
    <circle class="s2" cx="140" cy="64" r="2.6" fill="#aeefff" stroke="#0e2937" stroke-width="1.3"/>
    <circle class="s3" cx="34" cy="118" r="2.4" fill="#aeefff" stroke="#0e2937" stroke-width="1.2"/>
    <circle class="s4" cx="166" cy="118" r="2.4" fill="#aeefff" stroke="#0e2937" stroke-width="1.2"/>
    <circle class="s5" cx="52" cy="160" r="2.1" fill="#aeefff" stroke="#0e2937" stroke-width="1.1"/>
    <circle class="s6" cx="148" cy="160" r="2.1" fill="#aeefff" stroke="#0e2937" stroke-width="1.1"/>
  </g>

  <g id="glasses" fill="none" stroke="#0e2937" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="80" cy="104" r="14" fill="#0e2937" fill-opacity="0.06" stroke-width="2.6"/>
    <circle cx="120" cy="104" r="14" fill="#0e2937" fill-opacity="0.06" stroke-width="2.6"/>
    <path d="M94 104 Q100 101 106 104" stroke-width="2.4"/>
    <path d="M66 102 L58 97" stroke-width="2.4"/>
    <path d="M134 102 L142 97" stroke-width="2.4"/>
    <circle cx="76" cy="100" r="1.4" fill="#ffffff" opacity="0.85" stroke="none"/>
    <circle cx="116" cy="100" r="1.4" fill="#ffffff" opacity="0.85" stroke="none"/>
  </g>

  <g id="notepad" transform="rotate(-7 100 152)">
    <rect x="74" y="132" width="52" height="40" rx="2" fill="#faf6e6" stroke="#0e2937" stroke-width="2"/>
    <rect x="74" y="130" width="52" height="6" fill="#e2d8b8" stroke="#0e2937" stroke-width="1.4"/>
    <g fill="#0e2937">
      <rect x="79" y="128" width="3" height="9" rx="1.5"/>
      <rect x="87" y="128" width="3" height="9" rx="1.5"/>
      <rect x="95" y="128" width="3" height="9" rx="1.5"/>
      <rect x="103" y="128" width="3" height="9" rx="1.5"/>
      <rect x="111" y="128" width="3" height="9" rx="1.5"/>
      <rect x="119" y="128" width="3" height="9" rx="1.5"/>
    </g>
    <g stroke="#9aa1ab" stroke-width="0.9" stroke-linecap="round" fill="none">
      <line x1="80" y1="148" x2="120" y2="148"/>
      <line x1="80" y1="156" x2="118" y2="156"/>
      <line x1="80" y1="164" x2="114" y2="164"/>
    </g>
  </g>
</svg>`
