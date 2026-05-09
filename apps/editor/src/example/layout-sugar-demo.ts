/**
 * KMD Layout Sugar & Marker System Demo
 * 展现语法糖与预设标记系统的强大排版能力
 */

export const LayoutSugarDemo = `
[align=center] 布局系统语法糖演示

{[ 章节一 ]} @ f.markLineStart(L1).markLineEnd(R1)
这是一行普通的文字。
{我在这行的中间} @ f.markMiddle(center_label)
{我在章节名的左边} @ f.goto(L1).red
{我在章节名的右边} @ f.goto(R1).left(50).blue

---

{第一部分} @ f.markEnd(part1_end)
{紧跟在第一部分后面} @ f.offset(part1_end).right(10)
{在第一部分下方 20 像素} @ f.offset(part1_end).down(20).small.gray

---

{这是一段很长的文字，我们要标记它的特定位置} @ f.markStart(S).markEnd(E).f.markChar(5, FifthChar)
{起始点} @ f.goto(S).up(10).red
{结束点} @ f.goto(E).up(10).blue
{第五个字上方} @ f.goto(FifthChar).up(20).green

---

[align=left]
{上一句标记测试}
{我将引用上一句的末尾} @ f.goto(prev.end).down(1self).right(1self).red
{我将引用本行开头} @ f.goto(line.start).blue
{我是本行的下一行}

---

{居中对齐测试} @ f.left(0.5self).red
{偏移一个字} @ f.right(1char).green
{下沉一行} @ f.down(1line).blue
`;
