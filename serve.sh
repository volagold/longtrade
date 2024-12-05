__conda_setup="$('/Users/feili/miniconda3/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/Users/feili/miniconda3/etc/profile.d/conda.sh" ]; then
        . "/Users/feili/miniconda3/etc/profile.d/conda.sh"
    else
        export PATH="/Users/feili/miniconda3/bin:$PATH"
    fi
fi
unset __conda_setup
conda activate invest
cd backend
python api.py
# if [[ $1 ]]; then
#     python 0-trade.py --$1
# else
#     python 0-trade.py
# fi
