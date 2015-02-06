#!/bin/bash

# Depends: npm install -g jsdoc
DOC=doc
rm -rf $DOC
jsdoc -d $DOC data/contentscripts/api.js
cp -ru $DOC ../fathom.web/api
