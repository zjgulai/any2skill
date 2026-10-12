/**
 * 从模型响应里取出 JSON —— 全流水线**唯一**的一处实现。
 *
 * ## 为什么必须只有一处
 *
 * 2026-10-11 全书首跑 6/13 个文件退出码 4，归因一度被写成「模型在字符串里写了裸换行」。
 * 复现后是另一回事：**6/6 的原始响应本来就是合法 JSON**，是解析器把它切坏了。
 * 旧实现在整份响应上跑一个**未锚定**的围栏正则：
 *
 *     /```(?:json)?\s*([\s\S]*?)```/     ← 没有 ^ / $
 *
 * 正文里含代码块时（技术书稿里几乎必然），JSON 字符串**内部**必然出现 ```` ``` ````。
 * 这个正则从响应头部一路匹配到字符串内那个围栏的结束符，把一大段中间内容当成
 * 「围栏壳」剥掉，剩下的残片自然不是 JSON——错误串形如
 * `Unexpected token 'b', "bash\ngit "...`，那个 `'b'` 正是被切剩的 `bash` 的首字母。
 *
 * 同一个缺陷当时存在于**四个**解析器（第 2 层 / 判定者 / 主题提案 / 跨章综合），
 * 它们各自抄了一份同样的正则。判定者那一处尤其危险：它把「不该判错」的响应判成
 * 解析失败，而失败与真判否在回执里长得不一样、在人工复核时却同样容易被跳过。
 *
 * 因此本模块存在的理由不是「少写几行」，是**修一次就四处都修好**，
 * 且新增一个解析器时不会再把同一个缺陷抄第五遍。
 *
 * ## 顺序本身就是判据
 *
 * 三种形态按「越少加工越优先」尝试：
 *
 *   ① **整份原样** —— 响应以 `{` 开头是最常见的形态。**必须排第一位**：
 *      下面两步都是「从响应里切一块出来」，切点一旦猜错就会把一份合法 JSON 切成残片。
 *   ② **锚定围栏** —— 只有 ```` ``` ```` 分别落在**整份响应的首尾**时才剥壳。
 *      锚定同时解决了嵌套：`[\s\S]*?` 是惰性的，会先试到字符串内那个 ``` ，
 *      但 `\s*$` 不成立，正则回溯到最后一个能满足 `\s*$` 的 ```——即外层结束符。
 *   ③ **首 `{` → 末 `}`** —— 容忍前后夹带的解释文字。
 *
 * **不做语义修补**（转义裸换行、补引号、修逗号一律不碰）：判断「响应是否合法」的
 * 权力必须留在解析器手里。修补会让一份语义已损坏的响应看起来正常，而这个项目
 * 从头到尾的立场是——宁可规则报错，不让内容被悄悄改动。
 *
 * 本模块**不抛自己的错误类型**：四个调用方各有自己的错误类
 * （`Layer2Error` / `JudgeError` / `ThemeProposalError` / `SynthesisError`），
 * 而 `run.mjs` 正是按错误类型把失败归到不同 `engineeringFailure.kind` 的。
 * 统一成一个类会抹掉那个分类。因此这里只返回结果，由调用方包成自己的错误。
 */

/** 解析结果：`{ok:true, value}` 或 `{ok:false, diagnostic}`（diagnostic 是首次原样尝试的报错消息）。 */
export function extractJsonPayload(text) {
  const raw = String(text ?? '')
  const attempt = (s) => {
    try {
      return { ok: true, value: JSON.parse(s) }
    } catch {
      return { ok: false }
    }
  }

  const direct = attempt(raw.trim())
  if (direct.ok) return direct

  const fenced = /^\s*```(?:json|jsonc)?\s*([\s\S]*?)```\s*$/.exec(raw)
  if (fenced) {
    const unwrapped = attempt(fenced[1].trim())
    if (unwrapped.ok) return unwrapped
  }

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const braced = attempt(raw.slice(start, end + 1))
    if (braced.ok) return braced
  }

  // 诊断取自**首次原样尝试**：那才是「模型写坏了」与「解析器切坏了」的分界。
  let diagnostic = '未知'
  try {
    JSON.parse(raw.trim())
  } catch (err) {
    diagnostic = err.message
  }
  return { ok: false, diagnostic }
}
