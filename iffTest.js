// iffTest.js

function render(iff) {
	if (iff.renderScanLine()) {
//		setTimeout(function() { render(iff); }, 20);
		render(iff);
	} else {
		console.log('done');
	}
}

function showImage(filename) {
	var iff = new Iff(function(w, h) {
		$('#pic').attr('width', w);
		$('#pic').attr('height', h);

		// the [0] is because jquery selector returns an array even when there
		// is only one object matched
		var ctx = $('#pic').get()[0].getContext('2d');
		return ctx;
	});

	var xhr = new XMLHttpRequest();

	xhr.open('GET', '/pics/' + filename, true);
	xhr.responseType = 'arraybuffer';
	xhr.onreadystatechange = function(e) {
		if (xhr.readyState == 4) {
			console.log('status ' + xhr.status);
			if (xhr.status == 200) {
				var data = xhr.response;

				if (data) {
					try {
						iff.load(data);
						render(iff);
					} catch(ex) {
						alert(ex);
					}
				} else {
					alert("Couldn't read file");
					return false;
				}
			} else {
				console.log("Error", xhr.statusText);
			}
		}
	};
	xhr.send(null);
}

$(document).ready(function() {
	$('#fileList a').click(function() {
		showImage($(this).text());
	});
});

