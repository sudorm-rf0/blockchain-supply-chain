import "@testing-library/jest-dom/vitest";
import i18n from "@/lib/i18n";

// jsdom 未实现的 DOM API：Radix Select 打开/选择选项时会调用（否则交互测试报 unhandled error）
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// 测试环境使用默认语言（简体中文），让组件里的 t() 返回真实文案而非键名
beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});
