/* Panda stats sign-in metrics — loaded after stats.html's inline dashboard code. */
    (function () {
    function install() {
      var usageLabel = Array.prototype.find.call(document.querySelectorAll('.section-label'), function (node) {
        return (node.textContent || '').trim() === 'Usage';
      });
      if (!usageLabel || document.getElementById('signIns')) return;

      var section = document.createElement('div');
      section.innerHTML = ''
        + '<div class="section-label">Sign-ins</div>'
        + '<div class="grid">'
        + '<div class="card hi"><div class="n" id="signIns">—</div><div class="k">All time</div></div>'
        + '<div class="card"><div class="n" id="signInsToday">—</div><div class="k">Today</div></div>'
        + '<div class="card"><div class="n" id="signIns7">—</div><div class="k">Last 7 days</div></div>'
        + '<div class="card"><div class="n" id="signInsNative">—</div><div class="k">Native app</div></div>'
        + '<div class="card"><div class="n" id="signInsWebsite">—</div><div class="k">Website</div></div>'
        + '</div>';
      while (section.firstChild) usageLabel.parentNode.insertBefore(section.firstChild, usageLabel);

      var originalPaint = window.paint;
      if (typeof originalPaint !== 'function') return;
      window.paint = function (data) {
        originalPaint(data);
        document.getElementById('signIns').textContent = fmt(data.signIns);
        document.getElementById('signInsToday').textContent = fmt(data.signInsToday);
        document.getElementById('signIns7').textContent = fmt(data.signInsLast7);
        var platforms = Array.isArray(data.signInsByPlatform) ? data.signInsByPlatform : [];
        function countPlatform(platform) {
          var item = platforms.find(function (entry) { return entry.label === platform; });
          return fmt(item ? item.count : 0);
        }
        document.getElementById('signInsNative').textContent = countPlatform('native');
        document.getElementById('signInsWebsite').textContent = countPlatform('website');
      };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
    }());
    