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
    let Track { events } = serde_json::from_str(raw)?;
    timed_lesson(events, lang)
}

fn subtitle_ms(value: &str) -> Option<u64> {
    let value = value.trim();
    let mut parts = value.split([':', ',', '.']);
    let h: u64 = if value.matches(':').count() == 2 { parts.next()?.parse().ok()? } else { 0 };
    let m: u64 = parts.next()?.parse().ok()?;
    let s: u64 = parts.next()?.parse().ok()?;
    let fraction = parts.next()?;
    if h > 999 || m >= 60 || s >= 60 || fraction.len() != 3 || parts.next().is_some() {
        return None;
    }
    let ms: u64 = fraction.parse().ok()?;
    Some(((h * 60 + m) * 60 + s) * 1000 + ms)
}

pub fn subtitle_lesson(raw: &str, lang: &str) -> anyhow::Result<(String, String)> {
    let normalized = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let mut events = Vec::new();
    let webvtt = normalized.starts_with("WEBVTT");
    let mut previous_lines = Vec::new();
    let mut lines = normalized.lines().peekable();
    while let Some(line) = lines.next() {
        if webvtt && (line == "NOTE" || line.starts_with("NOTE ") || line == "STYLE" || line == "REGION") {
            while lines.peek().is_some_and(|line| !line.trim().is_empty()) { lines.next(); }
            continue;
        }
        let Some((start, end)) = line.split_once("-->") else { continue };
        let start = subtitle_ms(start).ok_or_else(|| anyhow::anyhow!("Invalid subtitle start time: {start}"))?;
        let end = end.split_whitespace().next().and_then(subtitle_ms)
            .ok_or_else(|| anyhow::anyhow!("Invalid subtitle end time"))?;
        anyhow::ensure!(end > start, "Subtitle cue ends before or at its start");
        let mut cue_lines = Vec::new();
        while lines.peek().is_some_and(|line| !line.trim().is_empty() && !line.contains("-->")) {
            cue_lines.push(lines.next().unwrap().trim());
        }
        // YouTube's rolling WebVTT repeats the preceding line above the new one.
        let rolling = webvtt && line.contains("align:start") && line.contains("position:");
        let overlap = if rolling {
            (1..=cue_lines.len().min(previous_lines.len())).rev()
                .find(|&count| previous_lines.ends_with(&cue_lines[..count])).unwrap_or(0)
        } else { 0 };
        let text = cue_lines[overlap..].join(" ");
        previous_lines = if rolling { cue_lines } else { Vec::new() };

        let mut segments = Vec::new();
        let mut clean = String::new();
        let mut tag = String::new();
        let mut markup = false;
        let mut offset = None;
        for c in text.chars() {
            match c {
                '<' if !markup => { markup = true; tag.clear(); }
                '>' if markup => {
                    markup = false;
                    if webvtt {
                        if let Some(time) = subtitle_ms(&tag).filter(|&time| time >= start && time < end) {
                            segments.push(Segment { utf8: std::mem::take(&mut clean), t_offset_ms: offset });
                            offset = Some(time - start);
                        }
                    }
                }
                _ if markup => tag.push(c),
                _ => clean.push(c),
            }
        }
        if webvtt {
            for seg in &mut segments {
                seg.utf8 = decode_vtt_entities(&seg.utf8);
            }
            clean = decode_vtt_entities(&clean);
        }
        segments.push(Segment { utf8: clean, t_offset_ms: offset });
        events.push(Cue { t_start_ms: start, d_duration_ms: Some(end - start), segs: segments });
    }
    timed_lesson(events, lang)
}

fn decode_vtt_entities(text: &str) -> String {
    text.replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
        .replace("&lrm;", "\u{200e}").replace("&rlm;", "\u{200f}").replace("&amp;", "&")
}

fn timed_lesson(mut events: Vec<Cue>, lang: &str) -> anyhow::Result<(String, String)> {
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
    fn vtt_supports_youtube_cue_settings_anchors_and_rolling_lines() {
        let raw = "WEBVTT\n\nNOTE ignored --> note\n\n00:01.000 --> 00:03.000 align:start position:0%\nHola <00:02.000><c>mundo</c>\n\n00:03.000 --> 00:04.000 align:start position:0%\nHola <00:02.000><c>mundo</c>\nAdiós.";
        let (text, timings) = subtitle_lesson(raw, "es").unwrap();
        assert_eq!(text.split_whitespace().collect::<Vec<_>>(), ["Hola", "mundo", "Adiós."]);
        let ranges: Vec<[f64; 4]> = serde_json::from_str(&timings).unwrap();
        assert_eq!(ranges.iter().map(|range| range[2]).collect::<Vec<_>>(), [1.0, 2.0, 3.0]);
    }

    #[test]
    fn srt_uses_cue_times_and_utf16_word_offsets() {
        let raw = "\u{feff}1\r\n00:00:01,200 --> 00:00:03,200\r\n<i>📖 שלום עולם.</i>\r\n \r\n2\r\n00:00:06,000 --> 00:00:07,000\r\nכן.";
        let (text, timing) = subtitle_lesson(raw, "he").unwrap();
        let times: Vec<[f64; 4]> = serde_json::from_str(&timing).unwrap();
        assert!(!text.contains("<i>"));
        assert_eq!(times.iter().map(|r| (r[2], r[3])).collect::<Vec<_>>(), [(1.2, 2.2), (2.2, 3.2), (6.0, 7.0)]);
        for (range, token) in times.iter().zip(crate::text::tokenize(&text, "he").into_iter().filter(|t| t.w)) {
            assert_eq!((range[0] as usize, range[1] as usize), (token.s, token.e));
        }
        assert!(subtitle_lesson("missing subtitles", "he").is_err());
    }

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
