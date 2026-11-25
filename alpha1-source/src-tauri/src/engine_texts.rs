//! Beschriftungen und Beschreibungen der Einstellungen zur Laufzeit aus der installierten Engine.
//! Simpliy liefert keine Texte der Engine aus. Der Katalog enthaelt nur Pruefsummen (FNV-1a, 32 Bit) der englischen
//! Originaltexte; hier werden sie mit der Uebersetzungsdatei der vom Nutzer installierten Engine aufgeloest.
use std::{collections::HashMap, fs, path::Path};

pub fn fnv(text: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for b in text.as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{h:08x}")
}

/// GNU-MO-Datei: (Original, Uebersetzung). Ohne Kontext-/Pluralbehandlung, die der Katalog nicht braucht.
pub fn read_mo(bytes: &[u8]) -> Result<Vec<(String, String)>, String> {
    let word = |at: usize, little: bool| -> Result<u32, String> {
        let b: [u8; 4] = bytes.get(at..at + 4).ok_or("MO-Datei zu kurz")?.try_into().map_err(|_| "MO")?;
        Ok(if little { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
    };
    let little = match bytes.get(0..4) {
        Some([0xde, 0x12, 0x04, 0x95]) => true,
        Some([0x95, 0x04, 0x12, 0xde]) => false,
        _ => return Err("Keine gültige Übersetzungsdatei".into()),
    };
    let count = word(8, little)? as usize;
    let (originals, translations) = (word(12, little)? as usize, word(16, little)? as usize);
    let text = |table: usize, i: usize| -> Result<String, String> {
        let len = word(table + 8 * i, little)? as usize;
        let off = word(table + 8 * i + 4, little)? as usize;
        let raw = bytes.get(off..off + len).ok_or("MO-Eintrag ausserhalb der Datei")?;
        Ok(String::from_utf8_lossy(raw).into_owned())
    };
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let original = text(originals, i)?;
        // Kontext ("ctx\u{4}text") und Plural ("a\0b"): nur den eigentlichen Text verwenden.
        let original = original.rsplit('\u{4}').next().unwrap_or("").split('\0').next().unwrap_or("").to_owned();
        let translated = text(translations, i)?.split('\0').next().unwrap_or("").to_owned();
        out.push((original, translated));
    }
    Ok(out)
}

/// Pruefsumme des englischen Texts -> deutscher Text (oder englischer, wenn nicht uebersetzt).
pub fn texts(engine_path: &str) -> Result<HashMap<String, String>, String> {
    let dir = Path::new(engine_path).parent().ok_or("Engine-Ordner fehlt")?;
    let mo = dir.join("resources").join("localization").join("de").join("LC_MESSAGES").join("PrusaSlicer.mo");
    let bytes = fs::read(&mo).map_err(|_| format!("Übersetzungen der Engine nicht gefunden: {}", mo.display()))?;
    Ok(read_mo(&bytes)?
        .into_iter()
        .filter(|(o, _)| !o.is_empty())
        .map(|(o, t)| (fnv(&o), if t.is_empty() { o } else { t }))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_matches_the_catalog_generator() {
        // Gleiche Werte wie tools/generate-catalog.mjs (FNV-1a 32 Bit ueber UTF-8).
        assert_eq!(fnv(""), "811c9dc5");
        assert_eq!(fnv("a"), "e40c292c");
        assert_eq!(fnv("Düse"), fnv("Düse"));
    }

    #[test]
    fn reads_a_small_mo_file() {
        // Zwei Eintraege, little endian.
        let pairs = [("Infill", "Füllung"), ("Speed", "Geschwindigkeit")];
        let mut head = Vec::new();
        let n = pairs.len() as u32;
        let (o_table, t_table) = (28u32, 28 + 8 * n);
        let mut data = Vec::new();
        let mut o_entries = Vec::new();
        let mut t_entries = Vec::new();
        let base = 28 + 16 * n;
        for (o, _) in pairs {
            o_entries.push((o.len() as u32, base + data.len() as u32));
            data.extend_from_slice(o.as_bytes());
            data.push(0);
        }
        for (_, t) in pairs {
            t_entries.push((t.len() as u32, base + data.len() as u32));
            data.extend_from_slice(t.as_bytes());
            data.push(0);
        }
        for v in [0x9504_12de_u32, 0, n, o_table, t_table, 0, 0] {
            head.extend_from_slice(&v.to_le_bytes());
        }
        for (l, o) in o_entries.into_iter().chain(t_entries) {
            head.extend_from_slice(&l.to_le_bytes());
            head.extend_from_slice(&o.to_le_bytes());
        }
        head.extend(data);
        let read = read_mo(&head).unwrap();
        assert_eq!(read, vec![("Infill".to_owned(), "Füllung".to_owned()), ("Speed".to_owned(), "Geschwindigkeit".to_owned())]);
    }

    /// Mit der echten Engine: die Beschreibung von fill_pattern wird gefunden.
    #[test]
    #[ignore]
    fn real_engine_texts() {
        let map = texts(&std::env::var("SIMPLIY_TEST_ENGINE").unwrap()).unwrap();
        assert!(map.len() > 3000, "{}", map.len());
    }
}
