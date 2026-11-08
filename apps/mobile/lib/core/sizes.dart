import 'package:flutter/material.dart';

/// One place that decides how big things are.
///
/// The app had drifted into per-screen magic numbers: a 92px icon here, a 54px
/// thumbnail there, buttons at 44, 48 and 52 depending on which screen they
/// were on. On a small phone that overflowed and on a large one it looked thin,
/// and the inconsistency is what makes a layout feel assembled rather than
/// designed.
///
/// Everything now scales from the screen width against a 390px reference (the
/// logical width of a modern mid-range Android phone). Width, not height,
/// because Persian text wraps and pushes content down -- height is not a
/// reliable budget. The result is clamped so a 320px phone stays readable and a
/// tablet does not get billboard-sized type.
@immutable
class Sizes {
  const Sizes._({
    required this.width,
    required this.scale,
    required this.gap,
    required this.gutter,
    required this.cardRadius,
  });

  factory Sizes.of(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    // Clamp: below 330 the layout needs to stay legible, above 520 it is
    // already a tablet and should not keep growing type.
    final raw = width / 390.0;
    final scale = raw.clamp(0.86, 1.16);
    return Sizes._(
      width: width,
      scale: scale,
      gap: (12 * scale).roundToDouble(),
      gutter: (16 * scale).roundToDouble(),
      cardRadius: (24 * scale).roundToDouble(),
    );
  }

  final double width;
  final double scale;
  final double gap;
  final double gutter;
  final double cardRadius;

  /// A length in reference pixels, scaled to this screen.
  double s(double value) => value * scale;

  /* ------------------------------ type ramp ------------------------------ */
  //
  // Six steps, used everywhere. Screens pick a step, not a size, so two labels
  // of the same importance are never 11 and 11.5 on neighbouring screens.

  double get display => s(23);
  double get title => s(17);
  double get subtitle => s(14);
  double get body => s(13);
  double get caption => s(11.5);
  double get micro => s(10.5);

  /* ------------------------------ components ----------------------------- */

  /// Primary action height. 48 is the floor for a comfortable tap target; the
  /// old 52 made the button shout on a 360px screen.
  double get button => s(48);
  /// Compact action (chips, inline "view all").
  double get buttonSmall => s(38);
  /// Round icon button that sits opposite a title.
  double get iconButton => s(38);
  /// Card padding.
  double get cardPad => s(14);
  /// Gap between a card's own rows.
  double get cardGap => s(10);

  /// Space a scrolling body needs under its last item so the floating nav pill
  /// does not sit on top of it.
  ///
  /// The pill is drawn over the body (the page shows through around it), so
  /// without this the final card ends up underneath it. Measured from the pill
  /// itself rather than guessed: tab padding + icon + label + the pill's own
  /// margin, plus the device's gesture inset.
  double navPillClearance(BuildContext context) =>
      s(62) + MediaQuery.paddingOf(context).bottom + s(16);

  /// Category grid: two columns, fixed by the reference design.
  double get categoryArt => s(104);
  double get categoryArtSmall => s(78);
}

/// Convenience so a widget can write `context.sizes.button` instead of
/// carrying a `Sizes` instance through every constructor.
extension SizesContext on BuildContext {
  Sizes get sizes => Sizes.of(this);
}
