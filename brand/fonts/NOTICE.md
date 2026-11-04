# Third-party font

`Hanken_Grotesk_700.ttf` is included as a **build input only**. It is read by
`outline_text` in `stamp.py` to convert the logo subline to outlines, and is
never served to a browser. The app loads Hanken Grotesk from Google Fonts at
runtime, separately from this file.

Metadata read from the file itself:

| Field | Value |
| --- | --- |
| Family | Hanken Grotesk |
| Style | Bold |
| Version | 3.013 |
| Copyright | Copyright 2021 The Hanken Grotesk Project Authors (https://github.com/marcologous/hanken-grotesk) |
| License URL | https://scripts.sil.org/OFL |

The font is licensed under the **SIL Open Font License, Version 1.1**, which
permits redistribution.

**Outstanding:** the OFL requires that the licence text accompany any
redistribution of the font, and the full `OFL.txt` is not in this directory.
The font binary carries a licence URL but no embedded licence description
(name ID 13 is absent), so the text could not be taken from the file, and this
session had no network access to `openfontlicense.org` or `scripts.sil.org` to
fetch it. Copy `OFL.txt` from the upstream project
(https://github.com/marcologous/hanken-grotesk) into this directory to close
that gap.

Note that outlines converted from an OFL font and embedded in an SVG are
derived artwork, not a redistribution of the font software, and the OFL does
not extend to documents that merely embed glyph outlines. The requirement
above is about shipping the `.ttf` itself, which this directory does.
