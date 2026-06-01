// SPDX-License-Identifier: AGPL-3.0-or-later
// MUSKO — the drowsy moss-sprite. Carriers: ears (droop <-> perk) + eyelids.
// Multi-tone cel shading, dual eye highlights, varied stroke weights
// (4.5 silhouette / 1.5-2 detail), faint moss texture.
import './musko.css'

export const musko = `<svg id="avatar" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <g id="creature" stroke-linejoin="round">
    <path id="earL" d="M82 70 C56 60 40 86 54 118 C72 110 86 90 82 70Z" fill="#3fa185" stroke="#1c2a24" stroke-width="4.5"/>
    <path d="M70 80 C58 80 52 98 58 112 C66 104 70 92 70 80Z" fill="#2f8a6e"/>
    <path id="earR" d="M118 70 C144 60 160 86 146 118 C128 110 114 90 118 70Z" fill="#3fa185" stroke="#1c2a24" stroke-width="4.5"/>
    <path d="M130 80 C142 80 148 98 142 112 C134 104 130 92 130 80Z" fill="#2f8a6e"/>
    <g id="sprout" stroke="#1c2a24" stroke-width="2" stroke-linejoin="round">
      <path d="M100 66 C95 50 84 49 88 63 C95 62 99 66 100 66Z" fill="#7fd66a"/>
      <path d="M100 66 C105 50 116 49 112 63 C105 62 101 66 100 66Z" fill="#7fd66a"/>
    </g>
    <g id="sleepcap">
      <path d="M82 66 Q80 44 100 38 Q120 44 118 66 Q108 68 100 68 Q92 68 82 66 Z" fill="#d8a896" stroke="#1c2a24" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M90 64 Q90 48 100 42" fill="none" stroke="#964e3a" stroke-width="1.4" opacity="0.7" stroke-linecap="round"/>
      <path d="M110 64 Q110 48 100 42" fill="none" stroke="#964e3a" stroke-width="1.4" opacity="0.7" stroke-linecap="round"/>
      <ellipse cx="100" cy="68" rx="18" ry="3" fill="#b8887c" stroke="#1c2a24" stroke-width="2"/>
      <circle cx="100" cy="38" r="3.6" fill="#7fd66a" stroke="#1c2a24" stroke-width="1.6"/>
    </g>
    <ellipse cx="84" cy="170" rx="12" ry="7" fill="#3fa185" stroke="#1c2a24" stroke-width="4.5"/>
    <ellipse cx="116" cy="170" rx="12" ry="7" fill="#3fa185" stroke="#1c2a24" stroke-width="4.5"/>
    <ellipse cx="100" cy="180" rx="40" ry="7" fill="#1c2a24" opacity="0.12"/>
    <ellipse cx="100" cy="120" rx="56" ry="52" fill="#58c0a0" stroke="#1c2a24" stroke-width="4.5"/>
    <path d="M138 86 A56 52 0 0 1 140 156 A56 52 0 0 0 138 86Z" fill="#3fa185"/>
    <path d="M150 116 A56 52 0 0 1 132 162 A40 40 0 0 0 150 116Z" fill="#2f8a6e"/>
    <path d="M64 158 Q100 176 136 158 Q100 170 64 158Z" fill="#2f8a6e" opacity="0.55"/>
    <g stroke="#3fa185" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.7">
      <path d="M68 98 l4 -5 M60 112 l5 -3 M128 158 l4 3 M86 160 l-4 3 M150 132 l-4 -3"/>
    </g>
    <ellipse cx="100" cy="136" rx="30" ry="31" fill="#f3ead0" stroke="#1c2a24" stroke-width="2.5"/>
    <path d="M74 150 Q100 168 126 150 Q100 160 74 150Z" fill="#e6d8b4"/>
    <ellipse id="armL" cx="48" cy="128" rx="11" ry="15" fill="#58c0a0" stroke="#1c2a24" stroke-width="4.5"/>
    <ellipse id="armR" cx="152" cy="128" rx="11" ry="15" fill="#58c0a0" stroke="#1c2a24" stroke-width="4.5"/>
    <ellipse cx="66" cy="118" rx="8" ry="5" fill="#ff8e72"/>
    <ellipse cx="134" cy="118" rx="8" ry="5" fill="#ff8e72"/>
    <!-- Leaf-blanket. Top edge has four leaf-tip bumps (Q-curves up to y=96)
         instead of a soft wave. Width 64px hugging body silhouette. Fade
         palette uses musko's existing greens (#6ba656 / #4a8038 / #9bd674).
         Tapered sides + rounded bottom merging at y=160 (just over arms). -->
    <g id="blanket">
      <path d="M68 142 Q76 134 86 140 Q94 134 102 140 Q110 134 116 140 Q124 134 132 142 Q136 160 130 176 Q114 180 100 180 Q86 180 70 176 Q64 160 68 142 Z" fill="#d8a896" stroke="#1c2a24" stroke-width="3.2" stroke-linejoin="round"/>
      <path d="M126 146 L132 144 Q136 160 130 176 L126 174 Q132 160 126 146 Z" fill="#b8887c"/>
      <path d="M84 156 Q100 158 116 156" stroke="#964e3a" stroke-width="1.6" opacity="0.7" fill="none" stroke-linecap="round"/>
      <path d="M82 168 Q100 170 118 168" stroke="#964e3a" stroke-width="1.6" opacity="0.7" fill="none" stroke-linecap="round"/>
      <path d="M70 142 Q82 134 96 140" fill="none" stroke="#e8c4b0" stroke-width="1.5" opacity="0.75" stroke-linecap="round"/>
      <path d="M104 140 Q116 134 130 142" fill="none" stroke="#e8c4b0" stroke-width="1.5" opacity="0.75" stroke-linecap="round"/>
    </g>
    <ellipse cx="78" cy="104" rx="12" ry="13" fill="#ffffff" stroke="#1c2a24" stroke-width="2"/>
    <path d="M69 108 Q78 113 87 108" fill="none" stroke="#b9c6d4" stroke-width="2.4" opacity="0.5"/>
    <circle id="pupilL" cx="78" cy="106" r="5.5" fill="#1c2a24"/>
    <circle cx="75" cy="102" r="2.6" fill="#ffffff"/>
    <circle cx="81.5" cy="109" r="1.4" fill="#ffffff"/>
    <ellipse id="lidL" cx="78" cy="104" rx="13" ry="14" fill="#58c0a0"/>
    <path id="lashL" d="M67 104 q11 9 22 0" fill="none" stroke="#1c2a24" stroke-width="2.5" stroke-linecap="round"/>
    <ellipse cx="122" cy="104" rx="12" ry="13" fill="#ffffff" stroke="#1c2a24" stroke-width="2"/>
    <path d="M113 108 Q122 113 131 108" fill="none" stroke="#b9c6d4" stroke-width="2.4" opacity="0.5"/>
    <circle id="pupilR" cx="122" cy="106" r="5.5" fill="#1c2a24"/>
    <circle cx="119" cy="102" r="2.6" fill="#ffffff"/>
    <circle cx="125.5" cy="109" r="1.4" fill="#ffffff"/>
    <ellipse id="lidR" cx="122" cy="104" rx="13" ry="14" fill="#58c0a0"/>
    <path id="lashR" d="M111 104 q11 9 22 0" fill="none" stroke="#1c2a24" stroke-width="2.5" stroke-linecap="round"/>
    <ellipse id="mouth" cx="100" cy="127" rx="7" ry="5" fill="#7a3b32"/>
    <path d="M94 126 q6 -3 12 0" fill="none" stroke="#5a2820" stroke-width="1.4" stroke-linecap="round"/>
    <g id="notepad" transform="rotate(-7 100 152)">
      <rect x="74" y="132" width="52" height="40" rx="2" fill="#faf6e6" stroke="#1c2a24" stroke-width="2"/>
      <rect x="74" y="130" width="52" height="6" fill="#e2d8b8" stroke="#1c2a24" stroke-width="1.4"/>
      <g fill="#1c2a24">
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
    <g id="glasses" fill="none" stroke="#1c2a24" stroke-linejoin="round" stroke-linecap="round">
      <circle cx="78" cy="104" r="13.5" fill="#1c2a24" fill-opacity="0.06" stroke-width="2.6"/>
      <circle cx="122" cy="104" r="13.5" fill="#1c2a24" fill-opacity="0.06" stroke-width="2.6"/>
      <path d="M91.5 103 Q100 100 108.5 103" stroke-width="2.4"/>
      <path d="M64.6 102 L57 97" stroke-width="2.4"/>
      <path d="M135.4 102 L143 97" stroke-width="2.4"/>
      <circle cx="74" cy="100" r="1.4" fill="#ffffff" opacity="0.85" stroke="none"/>
      <circle cx="118" cy="100" r="1.4" fill="#ffffff" opacity="0.85" stroke="none"/>
    </g>
  </g>
  <g id="zzz" fill="#1c2a24" stroke="#ffffff" stroke-width="0.8" font-family="'Segoe UI', sans-serif" font-weight="700">
    <text class="z z1" x="132" y="64" font-size="14">z</text>
    <text class="z z2" x="140" y="56" font-size="11">z</text>
    <text class="z z3" x="147" y="49" font-size="9">z</text>
  </g>
  <text id="bang" x="100" y="40" text-anchor="middle" font-size="34" font-family="'Segoe UI', sans-serif" font-weight="800" fill="#ff8e72" stroke="#1c2a24" stroke-width="1.5">!</text>
</svg>`
