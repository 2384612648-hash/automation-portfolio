export const unitGroups = {
  length: { title: '长度', units: [['m', '米 m', 1], ['cm', '厘米 cm', .01], ['mm', '毫米 mm', .001], ['km', '千米 km', 1000], ['in', '英寸 in', .0254]] },
  mass: { title: '质量', units: [['kg', '千克 kg', 1], ['g', '克 g', .001], ['jin', '市斤（500 g）', .5], ['lb', '磅 lb', .45359237]] },
  angle: { title: '角度', units: [['deg', '角度 °', Math.PI / 180], ['rad', '弧度 rad', 1], ['rev', '圈 rev', 2 * Math.PI]] },
  rotation: { title: '转速', units: [['rpm', '转 / 分 rpm', Math.PI / 30], ['rad/s', '弧度 / 秒 rad/s', 1], ['rps', '转 / 秒 rps', 2 * Math.PI]] },
  speed: { title: '速度', units: [['m/s', '米 / 秒 m/s', 1], ['km/h', '千米 / 时 km/h', 1 / 3.6], ['mph', '英里 / 时 mph', .44704]] },
  time: { title: '时间', units: [['s', '秒 s', 1], ['min', '分钟 min', 60], ['h', '小时 h', 3600], ['ms', '毫秒 ms', .001]] },
  temperature: { title: '温度', units: [['C', '摄氏度 °C'], ['F', '华氏度 °F'], ['K', '开尔文 K']] },
  data: { title: '文件大小', units: [['B', '字节 B', 1], ['MB', 'MB（1000² B）', 1e6], ['MiB', 'MiB（1024² B）', 1024 ** 2], ['GB', 'GB（1000³ B）', 1e9], ['GiB', 'GiB（1024³ B）', 1024 ** 3]] }
};

export function convertUnit(value, group, from, to) {
  if (String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('请输入有效数字，也支持 1e3 这样的科学计数法。');
  const n = Number(value), definition = unitGroups[group];
  const a = definition?.units.find(unit => unit[0] === from), b = definition?.units.find(unit => unit[0] === to);
  if (!a || !b) throw new Error('请选择同一类别中的单位。');
  let result;
  if (group === 'temperature') {
    const celsius = from === 'F' ? (n - 32) * 5 / 9 : from === 'K' ? n - 273.15 : n;
    if (celsius < -273.150000001) throw new Error('温度不能低于绝对零度。');
    result = to === 'F' ? celsius * 9 / 5 + 32 : to === 'K' ? celsius + 273.15 : celsius;
  } else result = n * (a[2] / b[2]);
  if (!Number.isFinite(result)) throw new Error('数值超出可计算范围，请减小输入。');
  return Object.is(result, -0) ? 0 : result;
}

export function tidyExcerpt(text, joinLines = false) {
  const trimmed = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return joinLines ? trimmed.split('\n\n').map(paragraph => paragraph.replace(/\n/g, ' ')).join('\n\n') : trimmed;
}

export function readingMarkdown({ title, source, excerpt, thought, date }) {
  if (!title.trim() || !excerpt.trim()) throw new Error('请填写标题和原文摘录。');
  const single = value => value.replace(/[\r\n]+/g, ' ').trim();
  const safeTitle = single(title).replace(/[\\`*_{}\[\]<>#!|]/g, '\\$&');
  return '# ' + safeTitle + '\n\n- 来源 / 书名：' + single(source || '待补充') + '\n- 记录日期：' + single(date) + '\n\n## 原文摘录\n\n' + excerpt.replace(/\r\n?/g, '\n').split('\n').map(line => '> ' + line).join('\n') + '\n\n## 我的想法\n\n' + (thought.trim() || '（待填写）') + '\n';
}
