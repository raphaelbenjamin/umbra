//! Turn YouTube JSON3 captions into a lesson and UTF-16 playback ranges.
use serde::Deserialize;

#[derive(Deserialize)]
struct Track {
    events: Vec<Cue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cue {
    t_start_ms: u64,
    d_duration_ms: Option<u64>,
    #[serde(default)]
    segs: Vec<Segment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    #[serde(default)]
    utf8: String,
    t_offset_ms: Option<u64>,
}

pub fn lesson(raw: &str, lang: &str) -> anyhow::Result<(String, String)> {
    let Track { mut events } = serde_json::from_str(raw)?;
    events.retain(|cue| !cue.segs.iter().all(|seg| seg.utf8.trim().is_empty()));
    events.sort_by_key(|cue| cue.t_start_ms);
    let mut body = String::new();
    let mut body_len = 0;
    let mut timings = Vec::new();
    let mut last_end = 0;

    for (index, cue) in events.iter().enumerate() {
        let start = cue.t_start_ms;
        let next = events.get(index + 1).map(|next| next.t_start_ms);
        let end = cue.d_duration_ms.map(|duration| start.saturating_add(duration))
            .or(next).unwrap_or(start);
        let end = next.filter(|next| *next > start).map_or(end, |next| end.min(next));
        let floor = start.max(last_end);
        if end <= floor {
            continue;
        }
        let mut text = String::new();
        let mut len = 0;
        let mut anchors = vec![(0, floor)];
        for seg in &cue.segs {
            if let Some(offset) = seg.t_offset_ms {
                let time = start.saturating_add(offset).clamp(floor, end);
                if time > anchors.last().unwrap().1 && time < end {
                    anchors.push((len, time));
                }
            }
            // JSON3 can contain newlines inside a caption window.
            let line = seg.utf8.replace(['\r', '\n'], " ");
            len += line.encode_utf16().count();
            text.push_str(&line);
        }
        let words: Vec<_> = crate::text::tokenize(&text, lang).into_iter().filter(|t| t.w).collect();
        if words.is_empty() {
            continue;
        }
        if !body.is_empty() {
            body.push(' ');
            body_len += 1;
        }
        anchors.push((len, end));
        let mut first = 0;
        for pair in anchors.windows(2) {
            let from = pair[0].1 as f64;
            let to = pair[1].1 as f64;
            let count = words[first..].partition_point(|word| word.s < pair[1].0);
            for (i, word) in words[first..first + count].iter().enumerate() {
                let step = (to - from) / count as f64;
                timings.push([
                    (body_len + word.s) as f64, (body_len + word.e) as f64,
                    (from + i as f64 * step) / 1000.0, (from + (i + 1) as f64 * step) / 1000.0,
                ]);
            }
            first += count;
        }
        body.push_str(&text);
        body_len += len;
        last_end = end;
    }
    anyhow::ensure!(!timings.is_empty(), "no timed caption words");
    if timings.len() == 1 {
        return Ok((body, serde_json::to_string(&timings)?));
    }
    let timings = serde_json::to_string(&timings)?;
    Ok(crate::media::airy(&body, lang, &timings))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caption_words_keep_offsets_and_segment_times() {
        let raw = r#"{"events":[
            {"tStartMs":1000,"dDurationMs":4000,"segs":[
                {"utf8":"📖 שלום "},{"utf8":"עולם.","tOffsetMs":800}
            ]},
            {"tStartMs":3000,"dDurationMs":2000,"segs":[{"utf8":"בשנה טובה."}]}
        ]}"#;
        let (text, timing) = lesson(raw, "he").unwrap();
        let words = crate::text::tokenize(&text, "he");
        let times: Vec<[f64; 4]> = serde_json::from_str(&timing).unwrap();
        assert_eq!(times.len(), 4);
        for (range, token) in times.iter().zip(words.iter().filter(|token| token.w)) {
            assert_eq!([range[0] as usize, range[1] as usize], [token.s, token.e]);
        }
        assert_eq!((times[0][2], times[1][2], times[2][2], times[3][2]), (1.0, 1.8, 3.0, 4.0));
        assert!(lesson(r#"{"events":[{"tStartMs":0,"dDurationMs":1000}]}"#, "he").is_err());
    }
}
