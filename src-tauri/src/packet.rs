//! Antwort an die Oberflaeche: JSON-Kopf plus rohe Zahlenfelder, ohne den Umweg ueber Text.
//! Aufbau: u32 Kopflaenge, Kopf (mit Leerzeichen auf 4 Byte aufgefuellt), dann die Felder.
use serde_json::{json, Value};

pub struct Packet {
    data: Vec<u8>,
    arrays: Vec<Value>,
}

impl Packet {
    pub fn new() -> Self {
        Packet { data: Vec::new(), arrays: Vec::new() }
    }

    fn describe(&mut self, name: &str, kind: &str, length: usize) {
        self.arrays.push(json!({"name": name, "type": kind, "offset": self.data.len(), "length": length}));
    }

    pub fn f32(&mut self, name: &str, values: &[f32]) {
        self.describe(name, "f32", values.len());
        self.data.reserve(values.len() * 4);
        values.iter().for_each(|v| self.data.extend_from_slice(&v.to_le_bytes()));
    }

    pub fn u32(&mut self, name: &str, values: &[u32]) {
        self.describe(name, "u32", values.len());
        self.data.reserve(values.len() * 4);
        values.iter().for_each(|v| self.data.extend_from_slice(&v.to_le_bytes()));
    }

    pub fn finish(self, meta: Value) -> Result<Vec<u8>, String> {
        let mut head = serde_json::to_vec(&json!({"meta": meta, "arrays": self.arrays})).map_err(|e| e.to_string())?;
        head.resize(head.len().div_ceil(4) * 4, b' ');
        let mut out = Vec::with_capacity(4 + head.len() + self.data.len());
        out.extend_from_slice(&(head.len() as u32).to_le_bytes());
        out.extend_from_slice(&head);
        out.extend_from_slice(&self.data);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_stay_aligned_after_an_odd_header() {
        let mut packet = Packet::new();
        packet.f32("a", &[1.5, 2.5]);
        packet.u32("b", &[7]);
        let bytes = packet.finish(json!({"text": "Fächer"})).unwrap();
        let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        assert_eq!(length % 4, 0);
        assert_eq!(bytes.len(), 4 + length + 12);
        let head: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
        assert_eq!(head["arrays"][1]["offset"], 8);
    }
}
