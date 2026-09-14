/**
 * 导航兼容视图——**这段会被原样注入 iframe**（见 navigation-view.ts 的说明）。
 *
 * 它跑在浏览器里，不能 import 任何东西，也不该假设有打包器。
 * 所以这里是普通 JS，只依赖语言本身。
 *
 * ## 为什么不直接把数组转成对象
 *
 * 转回对象会让 `nav[0]` 这种**下标索引**拿到第 0 项——看着对，其实是巧合，
 * 而数组化之后它就是错的。Proxy 让所有非 id 的键一律 `undefined`，
 * 于是"还没改过来的适配器"表现为**该处文案回退到兜底值**（看得见、可定位），
 * 而不是"用了别的一项的内容"（静默串位，最难查）。
 */

/**
 * @param items 形如 `[{ id, label: { zh, en }, target }]`
 * @returns 按 id 索引的只读视图；非 id 的键一律 undefined
 */
function makeNavigationView(items) {
  var list = Array.isArray(items) ? items : [];
  var byId = new Map();
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (item && typeof item.id === "string" && item.label) byId.set(item.id, item.label);
  }
  return new Proxy(
    {},
    {
      get: function (_target, prop) {
        if (typeof prop !== "string") return undefined;
        return byId.get(prop);
      },
      // 只读：适配器不该改导航。写入静默忽略（严格模式下会抛，所以这里返回 true 让它过）。
      set: function () {
        return true;
      },
      has: function (_target, prop) {
        return typeof prop === "string" && byId.has(prop);
      },
      ownKeys: function () {
        return Array.from(byId.keys());
      },
      getOwnPropertyDescriptor: function () {
        return { enumerable: true, configurable: true };
      },
    },
  );
}

/**
 * 建一个 `nav(id)` 查找器：给 id 返回那一项的 `{ label, target }`。
 *
 * 新写的代码用这个，**别再 `nav[id]`**——后者只有 `label`，拿不到 `target`，
 * 而数组化的全部意义就是"指向哪里由数据决定，不由第几个决定"。
 */
function makeNavigationLookup(items) {
  var list = Array.isArray(items) ? items : [];
  return function (id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return undefined;
  };
}
