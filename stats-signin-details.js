/* Panda stats recent sign-in details — loaded after stats.html's inline dashboard code. */
    (function () {
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    }
    function install() {
      var usageLabel = Array.prototype.find.call(document.querySelectorAll('.section-label'), function (node) {
        return (node.textContent || '').trim() === 'Usage';
      });
      if (!usageLabel || document.getElementById('recentSignIns')) return;
      var section = document.createElement('div');
      section.id = 'recentSignIns';
      section.innerHTML = '<div class="section-label">Recent sign-ins</div><div class="emails" style="margin-top:14px"><div class="list" id="signInList" style="display:block;max-height:420px"></div></div>';
      usageLabel.parentNode.insertBefore(section, usageLabel);
      var originalPaint = window.paint;
      if (typeof originalPaint !== 'function') return;
      window.paint = function (data) {
        originalPaint(data);
        var list = document.getElementById('signInList');
        var rows = Array.isArray(data.signInDetails) ? data.signInDetails : [];
        if (!rows.length) { list.innerHTML = '<div class="empty">No sign-in details captured yet.</div>'; return; }
        list.innerHTML = rows.map(function (item) {
          var details = [];
          if (item.name) details.push('<span>' + esc(item.name) + '</span>');
          if (item.gender) details.push('<span>' + esc(item.gender) + '</span>');
          if (item.country) details.push('<span>' + esc(item.country) + '</span>');
          if (item.age) details.push('<span>Age ' + esc(item.age) + '</span>');
          if (item.provider) details.push('<span class="tag">' + esc(item.provider) + '</span>');
          return '<div class="erow"><div class="em">' + esc(item.email || 'No email') + '</div>' + (details.length ? '<div class="sub2">' + details.join('') + '</div>' : '') + '</div>';
        }).join('');
      };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
    }());
    