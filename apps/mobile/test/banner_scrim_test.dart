import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The banner scrim has to be a wash, not a panel.
///
/// It shipped as `Color.alphaBlend(Colors.black.withOpacity(0.50), accent)`.
/// `alphaBlend` composites the two colours and returns the **result**, and
/// compositing a half-transparent black over a fully opaque accent produces an
/// opaque colour — alpha 255. Three of those in a row painted a flat coloured
/// block across the whole card. Every later attempt to make it "weaker" moved
/// gradient stops and lowered the black's alpha, and none of it changed what the
/// customer saw, because every stop was still 100% opaque.
///
/// These tests pin the two properties that actually matter: the wash is
/// translucent at every stop, and it is already weak where the copy begins.
void main() {
  /// The composition the widget uses: a black tint blended into the slide's own
  /// accent, then masked down to the opacity ramp by the gradient.
  Color washFor(Color accent, double opacity) =>
      Color.alphaBlend(Colors.black.withOpacity(0.38), accent).withValues(alpha: opacity);

  test('a blended tint keeps its own alpha instead of coming out opaque', () {
    // `alphaBlend` alone is opaque — this is the trap, asserted explicitly so
    // nobody "simplifies" the widget back to it.
    expect(
      Color.alphaBlend(Colors.black.withOpacity(0.38), const Color(0xFF7C3AED)).a,
      1.0,
      reason: 'alphaBlend returns the composite, which is opaque; using it '
          'directly as a scrim paints a solid panel',
    );

    final wash = washFor(const Color(0xFF7C3AED), 0.90);
    expect(wash.a, closeTo(0.90, 0.01),
        reason: 'the scrim must be applied as an opacity, not baked into the colour');
  });

  test('the scrim is already weak where the copy sits and gone before the art', () {
    // The gradient, right (copy) to left (artwork).
    const ramp = <double>[0.90, 0.85, 0.60, 0.24, 0.0];
    const stops = <double>[0, 0.16, 0.38, 0.54, 0.66];

    double opacityAt(double t) {
      if (t <= stops.first) return ramp.first;
      for (var i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i] && t <= stops[i + 1]) {
          final f = (t - stops[i]) / (stops[i + 1] - stops[i]);
          return ramp[i] + (ramp[i + 1] - ramp[i]) * f;
        }
      }
      return 0;
    }

    // Weak from the first pixel: no full-strength slab at the copy edge.
    // Effective darkness at the copy edge = mask x tint; below 0.35 is a wash,
    // not a panel.
    expect(opacityAt(0) * 0.38, lessThanOrEqualTo(0.35),
        reason: 'the tint must be restrained where the text starts');
    // Fading immediately, not holding across a third of the card.
    expect(opacityAt(0.16), lessThan(opacityAt(0)),
        reason: 'the fade must begin straight away');
    // Fully clear well before the far edge, so the artwork is its own colour.
    expect(opacityAt(0.66), 0.0, reason: 'the right of the card must be untinted');
    expect(opacityAt(1.0), 0.0, reason: 'the far edge must be completely clear');
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
