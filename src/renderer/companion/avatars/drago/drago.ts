// SPDX-License-Identifier: AGPL-3.0-or-later
// DRAGO — grumpy ember-drake, STOCKIER UPRIGHT baby-dragon stance: head smaller
// than body, neck taper, body taller than wide with feet, slight asymmetry.
// Carriers: wings + horns (grouped with their shading); soft brow; ember grows
// on alert. No fang (mouth closed in idle/sleeping).
import './drago.css'

export const drago = `<svg id="avatar" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <g id="creature" stroke-linejoin="round">
    <g id="wingL">
      <path d="M64 110 C40 100 22 106 20 130 L34 124 L28 140 L44 134 L40 150 L62 142 C57 128 60 118 64 110Z" fill="#e8795a" stroke="#2a1410" stroke-width="4"/>
      <path d="M56 116 C44 114 34 120 32 134 C40 130 50 128 58 130 C56 124 56 120 56 116Z" fill="#c95f44"/>
    </g>
    <g id="wingR">
      <path d="M136 110 C160 100 178 106 180 130 L166 124 L172 140 L156 134 L160 150 L138 142 C143 128 140 118 136 110Z" fill="#e8795a" stroke="#2a1410" stroke-width="4"/>
      <path d="M144 116 C156 114 166 120 168 134 C160 130 150 128 142 130 C144 124 144 120 144 116Z" fill="#c95f44"/>
    </g>
    <path id="tail" d="M135 176 C184 190 196 148 180 136" fill="none" stroke="#2a1410" stroke-width="3" stroke-linecap="round"/>
    <path id="tailFlame" d="M175 136 c-11 -9 4 -24 10 -12 c7 -4 11 12 -1 16Z" fill="#ffb13b" stroke="#ff7a2f" stroke-width="1.5"/>
    <ellipse cx="100" cy="190" rx="40" ry="6" fill="#2a1410" opacity="0.12"/>
    <ellipse cx="84" cy="186" rx="13" ry="8" fill="#c2382e" stroke="#2a1410" stroke-width="4"/>
    <ellipse cx="116" cy="186" rx="13" ry="8" fill="#c2382e" stroke="#2a1410" stroke-width="4"/>
    <path d="M80 100 C74 116 62 124 61 150 C60 178 78 188 100 188 C122 188 142 178 141 150 C140 124 126 116 120 100 C113 92 87 92 80 100Z" fill="#d94b3f" stroke="#2a1410" stroke-width="4.5"/>
    <path d="M120 104 C130 118 134 142 130 168 C126 182 116 186 108 186 C124 180 126 150 116 110Z" fill="#b23529"/>
    <path d="M132 130 C136 150 130 174 112 184 C128 176 126 152 122 134Z" fill="#8f2820" opacity="0.6"/>
    <path d="M80 102 Q100 116 120 102 Q100 110 80 102Z" fill="#8f2820" opacity="0.5"/>
    <ellipse cx="100" cy="158" rx="26" ry="27" fill="#f4d9a8" stroke="#2a1410" stroke-width="2.5"/>
    <path d="M76 170 Q100 184 124 170 Q100 180 76 170Z" fill="#e3c489"/>
    <ellipse id="armL" cx="60" cy="140" rx="9" ry="13" fill="#d94b3f" stroke="#2a1410" stroke-width="4"/>
    <ellipse id="armR" cx="140" cy="140" rx="9" ry="13" fill="#d94b3f" stroke="#2a1410" stroke-width="4"/>
    <!-- Quilted dragon-blanket in deep ember-red. Wavy top, tapered sides,
         rounded bottom merging at y=180 (above feet shadow). 68px wide
         hugging Drago's stockier upright body. Dashed stitching in lighter
         red reads as quilted seams. Hidden until depth 2. -->
    <g id="blanket">
      <path d="M64 148 Q76 138 86 146 Q94 138 102 146 Q112 138 120 146 Q132 138 136 150 Q140 168 134 186 Q116 190 100 190 Q84 190 66 186 Q60 168 64 148 Z" fill="#6a8aa4" stroke="#2a1410" stroke-width="3.2" stroke-linejoin="round"/>
      <path d="M130 152 L136 150 Q140 168 134 186 L130 184 Q136 168 130 152 Z" fill="#4a6884"/>
      <path d="M82 162 L118 162" stroke="#efe3c8" stroke-width="1.4" opacity="0.75" stroke-dasharray="3 2" fill="none"/>
      <path d="M82 176 L118 176" stroke="#efe3c8" stroke-width="1.4" opacity="0.75" stroke-dasharray="3 2" fill="none"/>
      <path d="M100 150 L100 186" stroke="#efe3c8" stroke-width="1.4" opacity="0.75" stroke-dasharray="3 2" fill="none"/>
      <path d="M68 148 Q80 140 92 146" fill="none" stroke="#aac0d4" stroke-width="1.5" opacity="0.75" stroke-linecap="round"/>
      <path d="M108 146 Q120 140 132 148" fill="none" stroke="#aac0d4" stroke-width="1.5" opacity="0.75" stroke-linecap="round"/>
    </g>
    <!-- Dragon nightcap in matching ember-red with cream brim (matching the
         horn cream #efe3c8) and an ember pom-pom (matching tail flame). Sits
         between the horns at the head crown; horns drawn AFTER cap render
         on top so the horn tips appear to poke through the cap. -->
    <g id="sleepcap">
      <path d="M84 44 Q86 24 96 18 Q110 22 116 44 Z" fill="#8a2a24" stroke="#2a1410" stroke-width="2.8" stroke-linejoin="round"/>
      <ellipse cx="100" cy="44" rx="18" ry="3.5" fill="#efe3c8" stroke="#2a1410" stroke-width="2.2"/>
      <circle cx="96" cy="18" r="4.8" fill="#ffb13b" stroke="#2a1410" stroke-width="2"/>
      <circle cx="94.5" cy="16.5" r="1.4" fill="#ffd87a"/>
    </g>
    <g id="hornL">
      <path d="M84 54 Q56 36 58 14 Q70 30 100 56Z" fill="#efe3c8" stroke="#2a1410" stroke-width="4"/>
      <path d="M86 52 Q68 38 66 22 Q74 32 94 54Z" fill="#d8caa8"/>
    </g>
    <g id="hornR">
      <path d="M116 54 Q144 36 142 14 Q130 30 100 56Z" fill="#efe3c8" stroke="#2a1410" stroke-width="4"/>
      <path d="M114 52 Q132 38 134 22 Q126 32 106 54Z" fill="#d8caa8"/>
    </g>
    <circle cx="100" cy="74" r="31" fill="#d94b3f" stroke="#2a1410" stroke-width="4.5"/>
    <path d="M123 54 A31 31 0 0 1 118 102 A31 31 0 0 0 123 54Z" fill="#b23529"/>
    <ellipse cx="78" cy="88" rx="7" ry="4.5" fill="#f2a293" opacity="0.7"/>
    <ellipse cx="122" cy="88" rx="7" ry="4.5" fill="#f2a293" opacity="0.7"/>
    <ellipse cx="89" cy="78" rx="10" ry="10.5" fill="#ffffff" stroke="#2a1410" stroke-width="2"/>
    <path d="M81 82 Q89 86 97 82" fill="none" stroke="#b9c6d4" stroke-width="2" opacity="0.5"/>
    <circle id="pupilL" cx="89" cy="79" r="5" fill="#2a1410"/>
    <circle cx="86.5" cy="76" r="2.3" fill="#ffffff"/>
    <circle cx="91" cy="82" r="1.2" fill="#ffffff"/>
    <ellipse id="lidL" cx="89" cy="78" rx="11" ry="11.5" fill="#d94b3f"/>
    <path id="lashL" d="M79 78 q10 7 20 0" fill="none" stroke="#2a1410" stroke-width="2.5" stroke-linecap="round"/>
    <ellipse cx="111" cy="78" rx="10" ry="10.5" fill="#ffffff" stroke="#2a1410" stroke-width="2"/>
    <path d="M103 82 Q111 86 119 82" fill="none" stroke="#b9c6d4" stroke-width="2" opacity="0.5"/>
    <circle id="pupilR" cx="111" cy="79" r="5" fill="#2a1410"/>
    <circle cx="108.5" cy="76" r="2.3" fill="#ffffff"/>
    <circle cx="113" cy="82" r="1.2" fill="#ffffff"/>
    <ellipse id="lidR" cx="111" cy="78" rx="11" ry="11.5" fill="#d94b3f"/>
    <path id="lashR" d="M101 78 q10 7 20 0" fill="none" stroke="#2a1410" stroke-width="2.5" stroke-linecap="round"/>
    <path id="browL" d="M80 71 Q89 67 97 72" fill="none" stroke="#2a1410" stroke-width="2.6" stroke-linecap="round"/>
    <path id="browR" d="M120 71 Q111 67 103 72" fill="none" stroke="#2a1410" stroke-width="2.6" stroke-linecap="round"/>
    <ellipse cx="96" cy="92" rx="1.4" ry="1.4" fill="#2a1410"/>
    <ellipse cx="104" cy="92" rx="1.4" ry="1.4" fill="#2a1410"/>
    <ellipse id="mouth" cx="100" cy="101" rx="4" ry="2" fill="#5a1a14"/>
    <path d="M92 100 Q100 94 108 100" fill="none" stroke="#3a0f0c" stroke-width="2.2" stroke-linecap="round"/>
    <g id="notepad" transform="rotate(-7 100 152)">
      <rect x="72" y="132" width="56" height="42" rx="2" fill="#faf6e6" stroke="#2a1410" stroke-width="2"/>
      <rect x="72" y="130" width="56" height="6" fill="#e2d8b8" stroke="#2a1410" stroke-width="1.4"/>
      <g fill="#2a1410">
        <rect x="77" y="128" width="3" height="9" rx="1.5"/>
        <rect x="86" y="128" width="3" height="9" rx="1.5"/>
        <rect x="95" y="128" width="3" height="9" rx="1.5"/>
        <rect x="104" y="128" width="3" height="9" rx="1.5"/>
        <rect x="113" y="128" width="3" height="9" rx="1.5"/>
        <rect x="121" y="128" width="3" height="9" rx="1.5"/>
      </g>
      <g stroke="#9aa1ab" stroke-width="0.9" stroke-linecap="round" fill="none">
        <line x1="78" y1="148" x2="122" y2="148"/>
        <line x1="78" y1="156" x2="120" y2="156"/>
        <line x1="78" y1="164" x2="116" y2="164"/>
      </g>
    </g>
    <g id="glasses" fill="none" stroke="#2a1410" stroke-linejoin="round" stroke-linecap="round">
      <circle cx="89" cy="78" r="10.5" fill="#2a1410" fill-opacity="0.07" stroke-width="2.5"/>
      <circle cx="111" cy="78" r="10.5" fill="#2a1410" fill-opacity="0.07" stroke-width="2.5"/>
      <path d="M99 77 Q100 75 101 77" stroke-width="2.2"/>
      <path d="M78.5 76 L72 71" stroke-width="2.2"/>
      <path d="M121.5 76 L128 71" stroke-width="2.2"/>
      <circle cx="85" cy="74" r="1.3" fill="#ffffff" opacity="0.85" stroke="none"/>
      <circle cx="107" cy="74" r="1.3" fill="#ffffff" opacity="0.85" stroke="none"/>
    </g>
  </g>
  <!-- Smoke puffs replace the typical zzz text — dragon breathes smoke in its
       sleep. Circles inherit the zfloat keyframes (translate+scale+opacity)
       so they drift up-and-right exactly like the z's did, just rendered as
       puffy grey circles. -->
  <g id="zzz">
    <circle class="z z1" cx="138" cy="44" r="5" fill="#b5b5b5" stroke="#5a5a5a" stroke-width="0.8" opacity="0.9"/>
    <circle class="z z2" cx="146" cy="36" r="3.8" fill="#c5c5c5" stroke="#5a5a5a" stroke-width="0.7" opacity="0.9"/>
    <circle class="z z3" cx="153" cy="29" r="2.6" fill="#d5d5d5" stroke="#5a5a5a" stroke-width="0.6" opacity="0.9"/>
  </g>
  <text id="bang" x="152" y="38" text-anchor="middle" font-size="30" font-family="'Segoe UI', sans-serif" font-weight="800" fill="#ffb13b" stroke="#2a1410" stroke-width="1.5">!</text>
</svg>`
