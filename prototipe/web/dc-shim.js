(function (g) {
  function toComp(Vue, def) {
    return {
      props: def.props || [],
      template: def.template,
      setup: function (props) {
        var inst = new def.Cls(props);
        inst.props = props;
        var st = Vue.reactive(inst.state || {});
        inst.state = st;
        inst.setState = function (p) { if (typeof p === "function") p = p(st, props); Object.assign(st, p); };
        inst.forceUpdate = function () {};
        var vals = Vue.computed(function () { return inst.renderVals(); });
        var ret = {};
        Object.keys(vals.value).forEach(function (k) {
          Object.defineProperty(ret, k, { get: function () { return vals.value[k]; }, enumerable: true, configurable: true });
        });
        return ret;
      }
    };
  }
  function build(Vue, rootName, defs, create) {
    var app = create(toComp(Vue, defs[rootName]));
    Object.keys(defs).forEach(function (n) { if (n !== rootName) app.component(n.toLowerCase() + "-c", toComp(Vue, defs[n])); });
    return app;
  }
  g.DCBuild = build;
  g.DCMount = function (rootName, defs) { build(g.Vue, rootName, defs, g.Vue.createApp).mount("#app"); };
})(typeof window !== "undefined" ? window : globalThis);
