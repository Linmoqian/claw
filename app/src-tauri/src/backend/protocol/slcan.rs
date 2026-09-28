// Lawicel SLCAN 帧编解码与回执校验。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::super::slcan::CanFrame;

pub fn encode_frame(frame: &CanFrame) -> Result<String, String> {
    let max_id = if frame.extended { 0x1FFF_FFFF } else { 0x7FF };
    if frame.id > max_id {
        return Err("CAN 帧 ID 超出标准帧或扩展帧范围".into());
    }
    if frame.data.len() > 8 {
        return Err("经典 CAN 数据区最多 8 字节".into());
    }
    let kind = if frame.extended { 'T' } else { 't' };
    let width = if frame.extended { 8 } else { 3 };
    let mut command = format!("{kind}{:0width$X}{}", frame.id, frame.data.len());
    for byte in &frame.data {
        command.push_str(&format!("{byte:02X}"));
    }
    Ok(command)
}

pub fn acknowledged(bytes: &[u8], operation: &str) -> Result<(), String> {
    if bytes.contains(&0x07) {
        return Err(format!("CAN 适配器拒绝{operation}命令"));
    }
    let mut start = 0;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\r' {
            let record = &bytes[start..index];
            if record.is_empty() || record == b"z" || record == b"Z" {
                return Ok(());
            }
            start = index + 1;
        }
    }
    Err(format!("CAN 适配器未确认{operation}命令"))
}

pub fn valid_version(bytes: &[u8]) -> bool {
    bytes
        .windows(5)
        .any(|window| window[0] == b'V' && window[1..].iter().all(u8::is_ascii_hexdigit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_validates_acknowledgements() {
        assert_eq!(
            encode_frame(&CanFrame {
                id: 0x123,
                extended: false,
                data: vec![0xAB, 0xCD]
            })
            .unwrap(),
            "t1232ABCD"
        );
        assert!(acknowledged(b"\r", "开启").is_ok());
        assert!(acknowledged(b"\x07", "开启").is_err());
        assert!(valid_version(b"V1234\r"));
    }
}
