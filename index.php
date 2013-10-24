<?php

// This is not at all an example of how to architect a web application.

?><!DOCTYPE html>
<html>
	<head>
		<title>iffjs Test</title>
		<link rel="stylesheet" type="text/css" href="generic.css" />
		<script type="text/javascript" src="jquery.js"></script>
		<script type="text/javascript" src="iff.js"></script>
		<script type="text/javascript" src="iffTest.js"></script>
	</head>
	<body>
		<div id="fileList">
<?php
	$files = scandir(__DIR__ . DIRECTORY_SEPARATOR . 'pics');
	$list = [];
	foreach ($files as $file) {
		if ('.' == $file || '..' == $file) {
			continue;
		}
		$list[] = "<a href=\"#\">$file</a>";
	}
	echo implode(' | ', $list);
?>
		</div>
		<div id="viewer">
			<canvas width="16" height="16" id="pic">
				<h2>Canvas not supported</h2>
			</canvas>
		</div>
	</body>
</html>
