//! Bounded byte ring so a reloaded webview can replay recent terminal output.

use std::collections::VecDeque;

pub struct Scrollback {
    buf: VecDeque<u8>,
    cap: usize,
}

impl Scrollback {
    pub fn new(cap: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(cap.min(64 * 1024)),
            cap,
        }
    }

    pub fn push(&mut self, data: &[u8]) {
        if data.len() >= self.cap {
            self.buf.clear();
            self.buf.extend(&data[data.len() - self.cap..]);
            return;
        }
        let overflow = (self.buf.len() + data.len()).saturating_sub(self.cap);
        self.buf.drain(..overflow);
        self.buf.extend(data);
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_tail_within_cap() {
        let mut s = Scrollback::new(5);
        s.push(b"abc");
        s.push(b"defg");
        assert_eq!(s.snapshot(), b"cdefg");
        s.push(b"0123456789");
        assert_eq!(s.snapshot(), b"56789");
    }
}
