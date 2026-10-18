//! Minimal ANSI/VT escape stripper — enough to read prompts out of TUI output.

/// Strip CSI / OSC / two-byte escape sequences and control chars (keeps `\n`).
pub fn strip(input: &[u8]) -> String {
    #[derive(PartialEq)]
    enum S {
        Text,
        Esc,
        Csi,
        Osc,
        OscEsc,
    }
    let mut out = Vec::with_capacity(input.len());
    let mut st = S::Text;
    for &b in input {
        st = match st {
            S::Text => match b {
                0x1b => S::Esc,
                b'\n' => {
                    out.push(b'\n');
                    S::Text
                }
                b'\r' | b'\t' => {
                    out.push(b' ');
                    S::Text
                }
                0x00..=0x1f | 0x7f => S::Text,
                _ => {
                    out.push(b);
                    S::Text
                }
            },
            S::Esc => match b {
                b'[' => S::Csi,
                b']' => S::Osc,
                _ => S::Text,
            },
            S::Csi => {
                if (0x40..=0x7e).contains(&b) {
                    // cursor moves are visually spaces between words
                    out.push(b' ');
                    S::Text
                } else {
                    S::Csi
                }
            }
            S::Osc => match b {
                0x07 => S::Text,
                0x1b => S::OscEsc,
                _ => S::Osc,
            },
            S::OscEsc => S::Text,
        };
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Collapse whitespace runs to single spaces (per line).
pub fn squash(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for ch in s.chars() {
        if ch == ' ' {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(ch);
            space = false;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_csi_osc_and_controls() {
        let raw = b"\x1b]0;title\x07\x1b[1;32mDo you\x1b[0m\x1b[2Cwant\r\nok\x08";
        assert_eq!(squash(&strip(raw)).trim(), "Do you want \nok");
    }
}
