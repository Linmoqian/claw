// 飞特 SCS/STS 帧编解码。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

#[derive(Debug, PartialEq, Eq)]
pub struct StatusPacket {
    pub id: u8,
    pub error: u8,
    pub data: Vec<u8>,
}

// 长度含指令与校验，校验覆盖 ID 至参数末尾。
pub fn instruction_packet(id: u8, instruction: u8, parameters: &[u8]) -> Result<Vec<u8>, String> {
    if parameters.len() > 244 {
        return Err("舵机报文过长".into());
    }
    let mut packet = vec![0xFF, 0xFF, id, (parameters.len() + 2) as u8, instruction];
    packet.extend_from_slice(parameters);
    let sum = packet[2..]
        .iter()
        .fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
    packet.push(!sum);
    Ok(packet)
}

pub fn parse_status_frame(frame: &[u8]) -> Result<StatusPacket, String> {
    if frame.len() < 6 || frame[..2] != [0xFF, 0xFF] {
        return Err("舵机响应帧头无效".into());
    }
    let length = frame[3] as usize;
    if !(2..=246).contains(&length) || frame.len() != length + 4 {
        return Err("舵机响应长度无效".into());
    }
    let sum = frame[2..frame.len() - 1]
        .iter()
        .fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
    if frame[frame.len() - 1] != !sum {
        return Err("舵机响应校验和错误".into());
    }
    Ok(StatusPacket {
        id: frame[2],
        error: frame[4],
        data: frame[5..frame.len() - 1].to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_packet_and_response_checksum() {
        assert_eq!(
            instruction_packet(1, 2, &[56, 2]).unwrap(),
            vec![0xFF, 0xFF, 1, 4, 2, 56, 2, 0xBE]
        );
        let frame = [0xFF, 0xFF, 1, 4, 0, 0x34, 0x12, 0xB4];
        assert_eq!(parse_status_frame(&frame).unwrap().data, [0x34, 0x12]);
        assert!(parse_status_frame(&[0xFF, 0xFF, 1, 4, 0, 0x34, 0x12, 0]).is_err());
    }
}
