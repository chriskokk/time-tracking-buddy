// SPDX-License-Identifier: AGPL-3.0-or-later
// GATO — smug stray, seated cat. Compact seated proportions (roughly square,
// not stretched), smaller head, hint of front legs, grouped ears (inner moves
// with outer), plain cream belly, cheek blush. Carriers: ears + tail.
import './gato.css'

export const gato = `<svg id="avatar" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <g id="creature" stroke-linejoin="round">
    <g id="tail">
      <path d="M122 146 C170 158 192 126 166 110 C153 102 143 116 150 130" fill="none" stroke="#1a1a1a" stroke-width="15" stroke-linecap="round"/>
      <path d="M122 146 C170 158 192 126 166 110 C153 102 143 116 150 130" fill="none" stroke="#2a2a2a" stroke-width="9.5" stroke-linecap="round"/>
    </g>
    <ellipse cx="100" cy="160" rx="28" ry="5" fill="#1a1a1a" opacity="0.18"/>
    <path d="M80 86 C76 98 74 115 74 130 C74 148 82 158 100 158 C118 158 126 148 126 130 C126 115 124 98 120 86 C113 78 87 78 80 86Z" fill="#2a2a2a" stroke="#1a1a1a" stroke-width="4.5"/>
    <path d="M120 92 C126 104 124 130 110 154 C122 144 124 108 126 97Z" fill="#1a1a1a"/>
    <path d="M118 119 C122 140 114 156 102 156 C116 150 116 130 114 121Z" fill="#0d0d0d" opacity="0.5"/>
    <path d="M84 113 C80 130 82 144 88 154 M116 113 C120 130 118 144 112 154" fill="none" stroke="#1a1a1a" stroke-width="1.8" opacity="0.5"/>
    <ellipse cx="100" cy="122" rx="8" ry="19" fill="#ffffff" stroke="#1a1a1a" stroke-width="2.5"/>
    <path d="M95 133 Q100 140 105 133 Q100 137 95 133Z" fill="#e0e0e0"/>
    <ellipse id="armL" cx="91" cy="155" rx="10" ry="7" fill="#ffffff" stroke="#1a1a1a" stroke-width="3"/>
    <ellipse id="armR" cx="109" cy="155" rx="10" ry="7" fill="#ffffff" stroke="#1a1a1a" stroke-width="3"/>
    <path d="M92 157 l0 -4 M100 157 l0 -4 M108 157 l0 -4" stroke="#1a1a1a" stroke-width="1.2" opacity="0.6"/>
    <!-- Cozy knitted blanket, body-hugging drape (not a container). Native
         position covers chest-to-ground (top y≈108, bottom y≈158), width
         ≈60px to match the cat's silhouette plus a small overhang for
         fabric-sag. Tapered sides + rounded bottom merge with the body
         outline so it reads as cloth draped over, not a block behind.
         CSS translates it off-screen below at depth 0/1, up to lower-body
         at depth 2, and to chest at depth 3. -->
    <g id="blanket">
      <path d="M70 110 Q82 104 92 108 Q100 104 108 108 Q120 104 130 110 Q134 130 128 152 Q114 158 100 158 Q86 158 72 152 Q66 130 70 110 Z" fill="#a89bc8" stroke="#1a1a1a" stroke-width="3.2" stroke-linejoin="round"/>
      <path d="M126 114 L130 112 Q134 132 128 152 L124 150 Q130 132 126 114 Z" fill="#867aa8"/>
      <path d="M78 126 Q100 128 122 126" stroke="#867aa8" stroke-width="1.8" opacity="0.55" fill="none"/>
      <path d="M76 140 Q100 142 124 140" stroke="#867aa8" stroke-width="1.8" opacity="0.55" fill="none"/>
      <path d="M72 110 Q84 104 92 108" fill="none" stroke="#c8b8e0" stroke-width="1.5" opacity="0.7" stroke-linecap="round"/>
      <path d="M108 108 Q120 104 128 110" fill="none" stroke="#c8b8e0" stroke-width="1.5" opacity="0.7" stroke-linecap="round"/>
    </g>
    <g id="earL">
      <path d="M82 44 L70 16 L102 40Z" fill="#2a2a2a" stroke="#1a1a1a" stroke-width="4.5"/>
      <path d="M84 40 L76 24 L96 38Z" fill="#ffffff"/>
      <path d="M80 39 L74 26 L84 35Z" fill="#ffb0b0" opacity="0.85"/>
    </g>
    <g id="earR">
      <path d="M118 44 L130 16 L98 40Z" fill="#2a2a2a" stroke="#1a1a1a" stroke-width="4.5"/>
      <path d="M116 40 L124 24 L104 38Z" fill="#ffffff"/>
      <path d="M120 39 L126 26 L116 35Z" fill="#ffb0b0" opacity="0.85"/>
    </g>
    <!-- Floppy nightcap with white pom-pom. Native position sits between the
         ears at head top (base y=28, tip slumping left to y=8). Hidden by
         default; depth 3 pops it in (scale 0.3 → 1.0 with opacity). The cap
         is drawn AFTER ears so it renders on top if they overlap; depth-3
         ears stay at the depth-0 angle (we removed the head-distorting
         flatten), so there's no overlap in practice. -->
    <g id="sleepcap">
      <path d="M82 28 Q84 16 92 8 Q108 12 118 28 Z" fill="#a89bc8" stroke="#1a1a1a" stroke-width="2.8" stroke-linejoin="round"/>
      <ellipse cx="100" cy="28" rx="20" ry="3.5" fill="#c8b8e0" stroke="#1a1a1a" stroke-width="2.2"/>
      <circle cx="92" cy="8" r="4.8" fill="#ffffff" stroke="#1a1a1a" stroke-width="2"/>
      <circle cx="90.5" cy="6.5" r="1.3" fill="#dddddd"/>
    </g>
    <circle cx="100" cy="54" r="26" fill="#2a2a2a" stroke="#1a1a1a" stroke-width="4.5"/>
    <path d="M119 38 A26 26 0 0 1 115 78 A26 26 0 0 0 119 38Z" fill="#1a1a1a"/>
    <ellipse cx="80" cy="60" rx="7" ry="4.5" fill="#ffb0a0" opacity="0.55"/>
    <ellipse cx="120" cy="60" rx="7" ry="4.5" fill="#ffb0a0" opacity="0.55"/>
    <g stroke="#4a4a4a" stroke-width="3.4" stroke-linecap="round" fill="none">
      <path d="M90 34 q3 8 1 14 M100 31 q0 9 0 15 M110 34 q-3 8 -1 14 M83 39 q1 6 0 11 M117 39 q-1 6 0 11"/>
    </g>
    <g stroke="#6a6a6a" stroke-width="1.1" stroke-linecap="round" fill="none" opacity="0.75">
      <path d="M77 48 l-4 -2 M76 53 l-5 -1 M123 48 l4 -2 M124 53 l5 -1"/>
    </g>
    <ellipse cx="90" cy="56" rx="9" ry="9.5" fill="#ffffff" stroke="#1a1a1a" stroke-width="2"/>
    <path d="M82 60 Q90 64 98 60" fill="none" stroke="#b9c6d4" stroke-width="2" opacity="0.5"/>
    <ellipse id="pupilL" cx="90" cy="56" rx="2.4" ry="6.5" fill="#1a1a1a"/>
    <circle cx="87.5" cy="53" r="2.1" fill="#ffffff"/>
    <circle cx="92" cy="59" r="1.1" fill="#ffffff"/>
    <ellipse id="lidL" cx="90" cy="56" rx="10" ry="10.5" fill="#2a2a2a"/>
    <path id="lashL" d="M81 56 q9 7 18 0" fill="none" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round"/>
    <ellipse cx="110" cy="56" rx="9" ry="9.5" fill="#ffffff" stroke="#1a1a1a" stroke-width="2"/>
    <path d="M102 60 Q110 64 118 60" fill="none" stroke="#b9c6d4" stroke-width="2" opacity="0.5"/>
    <ellipse id="pupilR" cx="110" cy="56" rx="2.4" ry="6.5" fill="#1a1a1a"/>
    <circle cx="107.5" cy="53" r="2.1" fill="#ffffff"/>
    <circle cx="112" cy="59" r="1.1" fill="#ffffff"/>
    <ellipse id="lidR" cx="110" cy="56" rx="10" ry="10.5" fill="#2a2a2a"/>
    <path id="lashR" d="M101 56 q9 7 18 0" fill="none" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M95 65 l10 0 l-5 5Z" fill="#ff9aa0" stroke="#1a1a1a" stroke-width="1.5"/>
    <path d="M100 70 q-6 6 -12 1 M100 70 q6 6 12 1" fill="none" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>
    <ellipse id="mouth" cx="100" cy="72" rx="4" ry="2.3" fill="#7a3b32"/>
    <g stroke="#ffffff" stroke-linecap="round" fill="none" stroke-width="1.1">
      <path d="M76 62 l-20 -5"/>
      <path d="M76 68 l-21 1"/>
      <path d="M78 74 l-20 5"/>
      <path d="M124 62 l20 -5"/>
      <path d="M124 68 l21 1"/>
      <path d="M122 74 l20 5"/>
    </g>
    <g id="notepad" transform="rotate(-7 100 148)">
      <rect x="68" y="128" width="64" height="40" rx="2" fill="#faf6e6" stroke="#1a1a1a" stroke-width="2"/>
      <rect x="68" y="126" width="64" height="6" fill="#e2d8b8" stroke="#1a1a1a" stroke-width="1.4"/>
      <g fill="#1a1a1a">
        <rect x="73" y="124" width="3" height="9" rx="1.5"/>
        <rect x="83" y="124" width="3" height="9" rx="1.5"/>
        <rect x="93" y="124" width="3" height="9" rx="1.5"/>
        <rect x="103" y="124" width="3" height="9" rx="1.5"/>
        <rect x="113" y="124" width="3" height="9" rx="1.5"/>
        <rect x="123" y="124" width="3" height="9" rx="1.5"/>
      </g>
      <g stroke="#9aa1ab" stroke-width="0.9" stroke-linecap="round" fill="none">
        <line x1="74" y1="144" x2="126" y2="144"/>
        <line x1="74" y1="152" x2="124" y2="152"/>
        <line x1="74" y1="160" x2="120" y2="160"/>
      </g>
    </g>
    <g id="glasses" fill="none" stroke="#1a1a1a" stroke-linejoin="round" stroke-linecap="round">
      <circle cx="90" cy="56" r="10" fill="#1a1a1a" fill-opacity="0.08" stroke-width="2.4"/>
      <circle cx="110" cy="56" r="10" fill="#1a1a1a" fill-opacity="0.08" stroke-width="2.4"/>
      <path d="M99.5 55 Q100 53 100.5 55" stroke-width="2.1"/>
      <path d="M80 54 L74 50" stroke-width="2.1"/>
      <path d="M120 54 L126 50" stroke-width="2.1"/>
      <circle cx="86" cy="52" r="1.2" fill="#ffffff" opacity="0.85" stroke="none"/>
      <circle cx="106" cy="52" r="1.2" fill="#ffffff" opacity="0.85" stroke="none"/>
    </g>
  </g>
  <g id="zzz" fill="#1a1a1a" stroke="#ffffff" stroke-width="0.8" font-family="'Segoe UI', sans-serif" font-weight="700">
    <text class="z z1" x="138" y="38" font-size="14">z</text>
    <text class="z z2" x="146" y="30" font-size="11">z</text>
    <text class="z z3" x="153" y="23" font-size="9">z</text>
  </g>
  <text id="bang" x="152" y="36" text-anchor="middle" font-size="28" font-family="'Segoe UI', sans-serif" font-weight="800" fill="#ff9aa0" stroke="#1a1a1a" stroke-width="1.5">!</text>
</svg>`
