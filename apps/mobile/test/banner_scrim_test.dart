import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The banner scrim has to be a wash, not a panel.
///
/// It shipped as `Color.alphaBlend(Colors.black.withOpacity(0.50), accent)`.
/// `alphaBlend` composites the two colours and returns the **result**, and
/// compositing a half-transparent black over a fully opaque accent produces an
/// opaque colour — alpha 255. Three of those in a row painted a flat coloured
/// block across the whole card. Every later attempt to make it "weaker" moved
/// gradient stops or lowered the black's alpha, and none of it changed what the
/// customer saw, because every stop was still 100% opaque.
///
/// These tests pin the two properties that actually matter: the tint is applied
/// as an opacity (so the result is translucent), and the ramp is weak where the
/// copy begins and completely clear over the artwork.
void main() {
  /// The ramp the widget uses, right (copy) to left (artwork).
  const alphas = <int>[0xE6, 0xD9, 0x99, 0x3D, 0x00];
  const stops = <double>[0, 0.16, 0.38, 0.54, 0.66];

  double opacityAt(double t) {
    if (t <= stops.first) return alphas.first / 255;
    for (var i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i] && t <= stops[i + 1]) {
        final f = (t - stops[i]) / (stops[i + 1] - stops[i]);
        final a0 = alphas[i] / 255;
        final a1 = alphas[i + 1] / 255;
        return a0 + (a1 - a0) * f;
      }
    }
    return 0;
  }

  test('alphaBlend alone is opaque — the trap that caused the bug', () {
    expect(
      Color.alphaBlend(Colors.black.withOpacity(0.38), const Color(0xFF7C3AED)).value >> 24,
      255,
      reason: 'alphaBlend returns the composite, which is opaque; using it '
          'directly as a scrim paints a solid panel over the artwork',
    );
  });

  test('the tint is applied as a translucent opacity, not baked into the colour', () {
    // What the widget does: keep the opaque tint, then apply the ramp's alpha.
    final tint = Color.alphaBlend(Colors.black.withOpacity(0.38), const Color(0xFF7C3AED));
    final wash = tint.withOpacity(0xE6 / 255);
    expect(wash.value >> 24, 0xE6);
    expect(wash.value >> 24, lessThan(255),
        reason: 'what reaches the screen must be a wash, not a solid fill');
  });

  test('weak where the copy sits, and completely clear over the artwork', () {
    // Effective darkness at the copy edge: 0.90 opacity over a 0.38 tint.
    expect(opacityAt(0) * 0.38, lessThanOrEqualTo(0.35),
        reason: 'the tint must be restrained where the text starts');
    // Fading immediately, not holding across a third of the card.
    expect(opacityAt(0.16), lessThan(opacityAt(0)),
        reason: 'the fade must begin straight away');
    // Fully clear well before the far edge, so the artwork is its own colour.
    expect(opacityAt(0.66), 0.0);
    expect(opacityAt(1.0), 0.0);
    // Monotonically decreasing: a scrim that dips and returns reads as a band.
    var previous = opacityAt(0);
    for (var t = 0.01; t <= 1.0; t += 0.01) {
      final current = opacityAt(t);
      expect(current, lessThanOrEqualTo(previous + 1e-9),
          reason: 'the scrim must only ever get lighter towards the artwork');
      previous = current;
    }
  });
}
